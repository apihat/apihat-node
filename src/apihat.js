const os = require("os");
const fetch = require("node-fetch");

/**
 * Middleware function to log data to API Hat.
 * @param {Object} options - Configuration options.
 * @param {string} options.apiKey - API Key.
 * @param {string} options.projectId - Project ID.
 */
function useApiHat({ apiKey, projectId }) {
  return function (req, res, next) {
    const requestStartTime = process.hrtime();

    // Capture original methods
    const originalSend = res.send.bind(res);
    const originalRender = res.render.bind(res);

    let requestSize = Buffer.byteLength(JSON.stringify(req.body || ''), 'utf8'); // Request size

    res.send = function (body) {
      res.__apiHat_body_response = body;
      originalSend(body);
    };

    res.render = function (view, options, callback) {
      // Capture rendered body if callback is not provided
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      res.__apiHat_body_response = view;
      originalRender(view, options, callback);
    };

    // Call next middleware
    next();

    // After response is sent
    res.on("finish", () => {
      const error = res.locals.error || null;
      const fieldsToMaskMap = {};

      let responseSize = res.get("Content-Length") || Buffer.byteLength(res.__apiHat_body_response || '', 'utf8'); // Response size

      sendPayloadToApiHat(
          apiKey,
          projectId,
          {
            body: req.body,
            headers: req.headers,
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            protocol: req.protocol,
            httpVersion: req.httpVersion,
            size: requestSize // Request size in bytes
          },
          {
            body: res.__apiHat_body_response,
            headers: res.getHeaders(),
            statusCode: res.statusCode,
            length: responseSize // Response size in bytes
          },
          requestStartTime,
          error,
          fieldsToMaskMap
      );
    });
  };
}

/**
 * Sends the payload to API Hat.
 */
function sendPayloadToApiHat(apiKey, projectId, requestData, responseData, requestStartTime, error, fieldsToMaskMap) {
  const maskedRequestPayload = maskSensitiveValues(requestData.body, fieldsToMaskMap);
  const maskedResponsePayload = maskSensitiveValues(responseData.body, fieldsToMaskMap);

  let errors = [];

  if (error) {
    errors.push({
      source: "onException",
      type: "UNHANDLED_EXCEPTION",
      message: error.message,
      file: error.fileName,
      line: error.lineNumber,
    });
  }

  const protocol = `${requestData.protocol.toUpperCase()}/${requestData.httpVersion}`;

  // Convert request and response bodies to JSON strings if they are objects
  const requestBodyString = typeof requestData.body === 'object' ? JSON.stringify(requestData.body) : requestData.body || '';
  const responseBodyString = typeof responseData.body === 'object' ? JSON.stringify(responseData.body) : responseData.body || '';

  // Convert bytes to kilobytes
  const requestSizeInKB = Buffer.byteLength(requestBodyString, 'utf8') / 1024;
  const responseSizeInKB = Buffer.byteLength(responseBodyString, 'utf8') / 1024;

  const dataToSend = [
    {
      api_key: apiKey,
      project_id: projectId,
      version: "1.0.0", // or dynamically get it from package.json
      sdk: "node",
      data: {
        server: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          os: {
            name: os.platform(),
            release: os.release(),
            architecture: os.arch(),
          },
          software: null,
          signature: null,
          protocol: protocol,
        },
        language: {
          name: "node",
          version: process.version,
        },
        request: {
          timestamp: new Date().toISOString().replace("T", " ").substr(0, 19),
          ip: requestData.ip,
          url: requestData.url,
          user_agent: requestData.headers["user-agent"],
          method: requestData.method,
          headers: maskSensitiveValues(requestData.headers, fieldsToMaskMap),
          body: maskedRequestPayload !== undefined ? maskedRequestPayload : null,
          size: requestSizeInKB, // Add size in KB
        },
        response: {
          headers: maskSensitiveValues(responseData.headers, fieldsToMaskMap),
          code: responseData.statusCode,
          size: responseSizeInKB, // Add size in KB
          load_time: getRequestDuration(requestStartTime),
          body: maskedResponsePayload !== undefined ? maskedResponsePayload : null,
        },
        errors: errors,
      },
    }
  ];

  fetch("https://api.apihat.com/api/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(dataToSend),
  })
      .then(response => {
        if (!response.ok) {
          console.log(`[error] Sending data to API Hat failed: ${response.statusText}`);
        }
      })
      .catch(error => {
        console.error("[error] Sending data to API Hat failed", error);
      });
}

/**
 * Helper function to calculate the request duration.
 */
function getRequestDuration(startTime) {
  const NS_PER_SEC = 1e9;
  const NS_TO_MICRO = 1e3;
  const diff = process.hrtime(startTime);

  return Math.ceil((diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MICRO);
}

/**
 * Helper function to mask sensitive values.
 */
function maskSensitiveValues(payload, fieldsToMaskMap) {
  return payload;
}

module.exports = {
  useApiHat
};
