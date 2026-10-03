# TANAW IoT

ESP32 flood/climate station firmware and the Python receiver that collects its
readings in Neon Postgres.

## Layout
- `firmware/` ESP32 PlatformIO project. Reads DHT22 (temp/humidity) and an
  analog water sensor, shows status on an SSD1306 OLED, drives status LEDs and
  a buzzer, and POSTs readings over HTTPS.
- `server/receiver.py` FastAPI receiver for local HTTPS and AWS Lambda Function
  URLs. It writes readings to the shared Neon database.

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

The receiver validates it, checks a bearer token when configured, and inserts
the reported values into `station_readings`. The current firmware converts its
water percentage into an estimated centimeter value using
`WATER_FULL_SCALE_CM` before upload, so calibrate that setting before treating
the centimeter value as a measured depth. The receiver also accepts
`water_raw`, `water_percent`, and `status` when a station sends those fields; it
does not infer centimeter values from them.

## Run the server (local dev)

```bash
# 1. Generate a self-signed cert (dev only; needs openssl)
python iot/server/receiver.py --gen-cert

# 2. Configure DATABASE_URL and STATION_TOKEN in the repository .env file or
#    iot/server/.env. Use the Neon pooled URL for DATABASE_URL.

# 3. Start the local HTTPS server
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

`config.h`, `.env`, and the local TLS cert/key are not included in the Lambda zip.
The Lambda gets `DATABASE_URL` from Terraform. `STATION_TOKEN` is optional; if
it is unset, the public receiver accepts requests without bearer authentication.

Build the Lambda package from the repository root:

```bash
./.venv/bin/python scripts/build_iot_lambda.py
```

The script prints `build/iot_receiver.zip`, relative to `infra/`, for
`iot_lambda_zip_path` in `infra/dev.tfvars`. It packages only the receiver,
the API database settings/session modules, and Lambda-compatible dependencies.

Stations need a registered station row with its real location before sending
readings. The current firmware payload does not include coordinates. Run the
database migrations before deploying the receiver so the raw sensor columns
exist.

## Notes
- The firmware uses `client.setInsecure()` so a self-signed dev cert works.
  For production, pin the server certificate with `client.setCACert(...)`.
- `station_type = river` reports water level; `street` reports flood depth
  (dry baseline minus measured). Alert levels for street: 10 cm gutter,
  30 cm not passable for cars, 50 cm dangerous for people.
