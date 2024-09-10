const os = require("os");
const fetch = require("node-fetch"); // Make sure node-fetch is installed

/**
 * Middleware function to log data to API Hat.
 * @param {Object} options - Configuration options.
 * @param {string} options.apiKey - Your API Key.
 * @param {string} options.projectId - Your Project ID.
 */
function useApiHat({ apiKey, projectId }) {
  return function (req, res, next) {
    const requestStartTime = process.hrtime();

    // Capture original send function
    const originalSend = res.send.bind(res);

    res.send = function (body) {
      // Capture response data
      res.__apiHat_body_response = body;

      // Proceed with original send function
      originalSend(body);
    };

    // Call next middleware
    next();

    // After response is sent
    res.on("finish", () => {
      const error = res.locals.error || null;
      const fieldsToMaskMap = {}; // Define your fields to mask here

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
            httpVersion: req.httpVersion
          },
          {
            body: res.__apiHat_body_response,
            headers: res.getHeaders(),
            statusCode: res.statusCode,
            length: res.get("Content-Length") || null
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

  const dataToSend = {
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
      },
      response: {
        headers: maskSensitiveValues(responseData.headers, fieldsToMaskMap),
        code: responseData.statusCode,
        size: responseData.length || null,
        load_time: getRequestDuration(requestStartTime),
        body: maskedResponsePayload !== undefined ? maskedResponsePayload : null,
      },
      errors: errors,
    },
  };

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
