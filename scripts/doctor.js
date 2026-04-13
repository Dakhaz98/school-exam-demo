/**
 * Checks which process answers /api/health on the configured port.
 * Run from project root: npm run doctor
 */
const http = require("http");
const port = Number(process.env.PORT) || 3780;
const url = `http://127.0.0.1:${port}/api/health`;

http
  .get(url, (r) => {
    let body = "";
    r.on("data", (c) => {
      body += c;
    });
    r.on("end", () => {
      console.log("URL:", url);
      console.log("HTTP status:", r.statusCode);
      console.log("Header X-School-Exam-Build:", r.headers["x-school-exam-build"] || "(missing = not school-exam-demo)");
      const is404Html = body.includes("Cannot GET") || body.includes("<!DOCTYPE");
      if (r.statusCode === 404 && is404Html) {
        console.log("\n=== DIAGNOSIS ===");
        console.log("Port", port, "is used by ANOTHER program (not this Node app).");
        console.log("school-exam-demo defines GET /api/health — a 404 HTML page means wrong server.\n");
        console.log("FIX (Windows CMD or PowerShell, run as Administrator if needed):");
        console.log("  1) Find PID:");
        console.log("     netstat -ano | findstr :" + port);
        console.log("  2) Stop it (replace 12345 with the PID in the last column):");
        console.log("     taskkill /PID 12345 /F");
        console.log("  3) From this folder run:");
        console.log("     npm start");
        console.log("\nOR use another port without killing the other app:");
        console.log("  set PORT=3782");
        console.log("  npm start");
        console.log("  Then open http://localhost:3782 and run: set PORT=3782&& npm run doctor\n");
      } else {
        try {
          const j = JSON.parse(body);
          console.log("Body:", JSON.stringify(j, null, 2));
          if (!j.build) console.log("\nWarning: JSON has no build field. This may not be school-exam-demo.");
        } catch {
          console.log("Body (first 400 chars):", body.slice(0, 400));
        }
      }
    });
  })
  .on("error", (e) => {
    console.error("Request failed:", e.message);
    console.error("Nothing is listening on port", port, "or connection was refused.");
    console.error("Start the app: npm start");
  });
