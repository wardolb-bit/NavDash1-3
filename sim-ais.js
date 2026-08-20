const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8081 });

console.log("AIS simulator running on ws://localhost:8081");

let lat = 13.4443;
let lon = 144.7937;
let cog = 270;
let sog = 10.2;

setInterval(() => {
  lon -= 0.002;

  const ownShip = {
    mmsi: 123456789,
    lat,
    lon,
    sog,
    cog,
    heading: cog,
    source: "SIM AIS",
    lastSeen: Date.now()
  };

  const message = JSON.stringify(ownShip);

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  console.log(message);
}, 1000);