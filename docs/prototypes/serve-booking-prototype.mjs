// PROTOTYPE ONLY: serves the adjacent static booking-flow prototype locally.
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const port = 4173;
const page = resolve("docs/prototypes/booking-flow-prototype.html");

createServer((request, response) => {
  if (request.url !== "/" && request.url !== "/booking-flow-prototype.html" && !request.url?.startsWith("/booking-flow-prototype.html?")) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  createReadStream(page).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Booking-flow prototype: http://127.0.0.1:${port}/booking-flow-prototype.html?variant=A`);
});
