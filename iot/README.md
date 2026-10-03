# TANAW IoT

ESP32 flood/climate station firmware and the Python HTTPS receiver that
collects its readings.

## Layout
- `firmware/` ESP32 PlatformIO project. Reads DHT22 (temp/humidity) and an
  analog water sensor, shows status on an SSD1306 OLED, drives status LEDs and
  a buzzer, and POSTs readings over HTTPS.
- `server/receiver.py` Python HTTPS server (standard library only) that accepts
  the JSON readings and stores them in SQLite.

## Data flow
ESP32 reads sensors every 2 s and uploads a JSON reading every 10 s:

```json
{
  "station_id": "river-marikina-bridge-01",
  "station_type": "river",
  "temp_c": 31.4,
  "humidity_pct": 78.0,
  "water_raw": 1820,
  "water_percent": 61,
  "status": "NORMAL"
}
```

The server validates it, optionally checks a bearer token, and inserts it into
`station_readings`.

## Run the server (local dev)

```bash
# 1. Generate a self-signed cert (dev only; needs openssl)
python iot/server/receiver.py --gen-cert

# 2. (optional) require a shared secret
export TANAW_STATION_TOKEN=mysecret      # Windows: set TANAW_STATION_TOKEN=mysecret

# 3. Start it
python iot/server/receiver.py --host 0.0.0.0 --port 8443
```

Health check: `GET https://<host>:8443/health`.

## Configure the firmware

```bash
cp iot/firmware/src/config.example.h iot/firmware/src/config.h
# edit config.h: WiFi, SERVER_URL, STATION_TOKEN (match the server), STATION_ID
pio run -d iot/firmware            # build
pio run -d iot/firmware -t upload  # flash
```

`config.h`, the cert/key, and the SQLite db are gitignored.

## Notes
- The firmware uses `client.setInsecure()` so a self-signed dev cert works.
  For production, pin the server certificate with `client.setCACert(...)`.
- `station_type = river` reports water level; `street` reports flood depth
  (dry baseline minus measured). Alert levels for street: 10 cm gutter,
  30 cm not passable for cars, 50 cm dangerous for people.
