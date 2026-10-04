#include <Arduino.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#include "config.h"

#define DHT_PIN     4
// GPIO34 is on ADC1 (works while WiFi is active) and is input-only, which suits
// an analog sensor. ADC2 pins (e.g. GPIO14) cannot be read once WiFi is on.
#define WATER_PIN   34
#define OLED_SDA    21
#define OLED_SCL    22
#define GREEN_LED   25
#define YELLOW_LED  26
#define RED_LED     27
#define BUZZER_PIN  23
#define BUZZER_CHANNEL 0  // LEDC channel used to drive the buzzer

// Replace these examples with your measured dry and full readings.
const int WATER_DRY = 0;
const int WATER_WET = 3000;
static_assert(WATER_DRY != WATER_WET, "Calibration values must differ");

// Depth (cm) that corresponds to a 100% water reading. Used to convert the
// 0-100% sensor reading into water_level_cm / flood_depth_cm for the API.
const float WATER_FULL_SCALE_CM = 100.0f;

const float WARNING_TEMP = 38.0;
const float DANGER_TEMP = 40.0;

// How often to POST readings to the server, in milliseconds.
// 60s keeps Lambda invocations and Neon writes low (about 1,440 per day per
// station). Sensors are still read every 2s locally for the display and buzzer,
// so alerts stay responsive; only the network upload is less frequent.
const unsigned long UPLOAD_INTERVAL_MS = 60000;

DHT dht(DHT_PIN, DHT22);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

bool oledReady = false;
bool valid = false;
float temperature = NAN;
float humidity = NAN;
int waterRaw = 0;
int waterPercent = 0;
const char* status = "STARTING";

// Tracks the current danger state so loop() can pulse the buzzer.
bool buzzerActive = false;

unsigned long lastRead = 0;
unsigned long lastDisplay = 0;
unsigned long lastUpload = 0;

// Draws a pair of eyes with "TANAW" above and below them.
void drawEyes(bool open) {
  display.clearDisplay();

  // Top label
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  // Center "TANAW" (5 chars * 6 px = 30 px wide at size 1)
  display.setCursor((128 - 30) / 2, 2);
  display.print("TANAW");

  // Eyes in the middle
  if (open) {
    // Left eye (filled circle with pupil)
    display.fillCircle(44, 32, 11, SSD1306_WHITE);
    display.fillCircle(44, 32, 4, SSD1306_BLACK);
    // Right eye
    display.fillCircle(84, 32, 11, SSD1306_WHITE);
    display.fillCircle(84, 32, 4, SSD1306_BLACK);
  } else {
    // Blinking: draw as horizontal lines
    display.fillRect(33, 31, 22, 3, SSD1306_WHITE);
    display.fillRect(73, 31, 22, 3, SSD1306_WHITE);
  }

  // Bottom label
  display.setTextSize(1);
  display.setCursor((128 - 30) / 2, 54);
  display.print("TANAW");

  display.display();
}

// Shows the eyes splash for 5 seconds with a couple of blinks.
void showSplash() {
  if (!oledReady) {
    // No display: still hold for 5 seconds so timing is consistent.
    delay(5000);
    return;
  }

  unsigned long start = millis();
  while (millis() - start < 5000) {
    unsigned long t = millis() - start;
    // Blink closed briefly around 1.5s and 3.5s.
    bool blinking = (t > 1500 && t < 1700) ||
                    (t > 3500 && t < 3700);
    drawEyes(!blinking);
    delay(50);
  }
}

// Connect to WiFi (non-fatal: monitoring continues even if it fails).
void connectWiFi() {
  if (strlen(WIFI_SSID) == 0) {
    Serial.println("WiFi SSID not set; skipping network.");
    return;
  }
  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connect timed out; will retry later.");
  }
}

void readSensors() {
  temperature = dht.readTemperature();
  humidity = dht.readHumidity();
  valid = !isnan(temperature) && !isnan(humidity);

  uint32_t total = 0;
  for (int i = 0; i < 16; i++) {
    total += analogRead(WATER_PIN);
    delay(2);
  }
  waterRaw = total / 16;

  float percent = 100.0f * (waterRaw - WATER_DRY)
                  / (WATER_WET - WATER_DRY);
  percent = constrain(percent, 0.0f, 100.0f);
  waterPercent = (int)(percent + 0.5f);

  bool danger = valid && temperature >= DANGER_TEMP;
  bool warning = valid && temperature >= WARNING_TEMP && !danger;
  bool normal = valid && !warning && !danger;

  digitalWrite(GREEN_LED, normal ? HIGH : LOW);
  digitalWrite(YELLOW_LED, warning ? HIGH : LOW);
  digitalWrite(RED_LED, (danger || !valid) ? HIGH : LOW);

  // Buzzer sounds during the danger (HIGH TEMP) state.
  buzzerActive = danger;

  status = !valid ? "DHT ERROR" :
           danger ? "HIGH TEMP" :
           warning ? "TEMP WARNING" : "NORMAL";

  if (valid) {
    Serial.printf("Temp: %.1f C | Humidity: %.1f %% | ",
                  temperature, humidity);
  } else {
    Serial.print("DHT22 read failed | ");
  }

  Serial.printf("Water raw: %d | Water: %d%% | %s\n",
                waterRaw, waterPercent, status);
}

// Builds the JSON body and POSTs it over HTTPS to the TANAW server.
void uploadReading() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Upload skipped: no WiFi.");
      return;
    }
  }

  // Convert the 0-100% water reading to centimeters using the configured
  // full-scale depth, then send the field that matches this station type:
  //   river  -> water_level_cm
  //   street -> flood_depth_cm
  float water_cm = WATER_FULL_SCALE_CM * (waterPercent / 100.0f);
  bool isRiver = (strcmp(STATION_TYPE, "river") == 0);

  // JSON matches the TANAW API /ingest schema.
  char body[320];
  char tempField[24];
  char humField[24];
  if (valid) {
    snprintf(tempField, sizeof(tempField), "%.1f", temperature);
    snprintf(humField, sizeof(humField), "%.1f", humidity);
  } else {
    snprintf(tempField, sizeof(tempField), "null");
    snprintf(humField, sizeof(humField), "null");
  }

  if (isRiver) {
    snprintf(body, sizeof(body),
             "{\"station_id\":\"%s\",\"station_type\":\"%s\","
             "\"temp_c\":%s,\"humidity_pct\":%s,\"water_level_cm\":%.1f}",
             STATION_ID, STATION_TYPE, tempField, humField, water_cm);
  } else {
    snprintf(body, sizeof(body),
             "{\"station_id\":\"%s\",\"station_type\":\"%s\","
             "\"temp_c\":%s,\"humidity_pct\":%s,\"flood_depth_cm\":%.1f}",
             STATION_ID, STATION_TYPE, tempField, humField, water_cm);
  }

  // Pick the client by URL scheme: plain WiFiClient for http:// (Option A,
  // FastAPI on :8000) and WiFiClientSecure for https:// (if TLS is in front).
  bool useTls = (strncmp(SERVER_URL, "https:", 6) == 0);

  WiFiClient plainClient;
  WiFiClientSecure tlsClient;
  HTTPClient http;
  bool began;

  if (useTls) {
    // Self-signed dev server: skip cert validation. In production, pin the
    // server certificate with tlsClient.setCACert(...).
    tlsClient.setInsecure();
    began = http.begin(tlsClient, SERVER_URL);
  } else {
    began = http.begin(plainClient, SERVER_URL);
  }

  if (!began) {
    Serial.println("HTTP begin() failed.");
    return;
  }
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(STATION_TOKEN) > 0) {
    http.addHeader("Authorization", String("Bearer ") + STATION_TOKEN);
  }

  int code = http.POST((uint8_t*)body, strlen(body));
  if (code > 0) {
    Serial.printf("POST %s -> %d\n", SERVER_URL, code);
    if (code >= 400) {
      String response = http.getString();
      if (response.length() > 0) {
        Serial.printf("Server response: %s\n", response.c_str());
      }
    }
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

void drawScreen(bool showPercentage) {
  if (!oledReady) return;

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("CLIMATE WATER MONITOR");

  display.setCursor(0, 12);
  if (valid) {
    display.print("Temp: ");
    display.print(temperature, 1);
    display.print(" C");
  } else {
    display.print("Temp: unavailable");
  }

  display.setCursor(0, 23);
  if (valid) {
    display.print("Humidity: ");
    display.print(humidity, 1);
    display.print(" %");
  } else {
    display.print("Check DHT22 wiring");
  }

  display.setCursor(0, 39);
  display.print("Water:");

  // Only the percentage blinks; the other readings stay visible.
  if (showPercentage) {
    display.setTextSize(2);
    display.setCursor(48, 35);
    display.print(waterPercent);
    display.print("%");
  }

  display.setTextSize(1);
  display.setCursor(0, 56);
  display.print(status);
  display.display();
}

void setup() {
  Serial.begin(115200);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(WATER_PIN, INPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(RED_LED, LOW);

  // Attach the buzzer to a LEDC PWM channel so tones work on ESP32 Arduino
  // core 2.x. Channel 0, 2 kHz base, 8-bit resolution.
  ledcSetup(BUZZER_CHANNEL, 2000, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
  ledcWriteTone(BUZZER_CHANNEL, 0);  // start silent

  analogReadResolution(12);
  analogSetPinAttenuation(WATER_PIN, ADC_11db);

  dht.begin();
  Wire.begin(OLED_SDA, OLED_SCL);
  oledReady = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);

  if (oledReady) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    display.display();
  } else {
    Serial.println("OLED unavailable; monitoring continues.");
  }

  // Show the TANAW eyes splash for 5 seconds before sensing starts.
  showSplash();

  connectWiFi();

  readSensors();
  lastRead = millis();
  lastUpload = millis();
  uploadReading();
  drawScreen(true);
}

void loop() {
  unsigned long now = millis();

  if (now - lastRead >= 2000) {
    readSensors();
    lastRead = millis();
  }

  now = millis();

  // Passive buzzer: pulse a 2 kHz tone 250 ms on / 250 ms off while in the
  // danger state. Only change the LEDC output when the on/off state flips.
  static bool buzzerOn = false;
  bool wantOn = buzzerActive && (now % 500UL < 250UL);
  if (wantOn != buzzerOn) {
    buzzerOn = wantOn;
    ledcWriteTone(BUZZER_CHANNEL, buzzerOn ? 2000 : 0);
  }

  if (now - lastDisplay >= 100) {
    lastDisplay = now;
    drawScreen((now / 500) % 2 == 0);
  }

  // Push a reading to the server on a fixed interval.
  if (now - lastUpload >= UPLOAD_INTERVAL_MS) {
    lastUpload = now;
    uploadReading();
  }

  delay(10);
}
