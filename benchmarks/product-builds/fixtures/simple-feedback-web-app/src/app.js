const http = require("node:http");

function createApp(initialEntries = []) {
  const entries = [...initialEntries];

  function handle(req, res) {
    void entries;
    res.statusCode = 500;
    res.end("TODO");
  }

  function createServer() {
    return http.createServer(handle);
  }

  return {
    entries,
    handle,
    createServer
  };
}

module.exports = {
  createApp
};

