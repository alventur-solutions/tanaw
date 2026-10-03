# TANAW Climate & Water Monitor — Data Dictionary and Conditions

An ESP32-based environmental monitor that reads temperature, humidity, and water
level, then signals the state through LEDs, a buzzer, and an OLED display.
A "TANAW" eyes splash screen shows for 5 seconds at startup.

---

## 1. Pin Definitions

| Name       | Value | Type        | Direction  | Description |
|------------|-------|-------------|------------|-------------|
| DHT_PIN    | 4     | GPIO        | Input      | Data pin for the DHT22 temperature/humidity sensor |
| WATER_PIN  | 14    | GPIO (ADC)  | Input      | Analog pin reading the water-level sensor |
| OLED_SDA   | 21    | GPIO        | I2C data   | SDA line for the SSD1306 OLED display |
| OLED_SCL   | 22    | GPIO        | I2C clock  | SCL line for the SSD1306 OLED display |
| GREEN_LED  | 25    | GPIO        | Output     | Indicates NORMAL temperature state |
| YELLOW_LED | 26    | GPIO        | Output     | Indicates TEMP WARNING state |
| RED_LED    | 27    | GPIO        | Output     | Indicates DANGER (HIGH TEMP) or sensor error |
| BUZZER_PIN | 23    | GPIO        | Output     | Passive buzzer; pulses a tone during danger |

---

## 2. Constants

| Name         | Value  | Type  | Description |
|--------------|--------|-------|-------------|
| WATER_DRY    | 0      | int   | Raw ADC reading when sensor is fully dry (calibration) |
| WATER_WET    | 3000   | int   | Raw ADC reading when sensor is fully wet (calibration) |
| WARNING_TEMP | 38.0   | float | Temperature (deg C) at or above which a warning triggers |
| DANGER_TEMP  | 40.0   | float | Temperature (deg C) at or above which danger triggers |

---

## 3. Global Variables

| Name         | Type              | Initial     | Description |
|--------------|-------------------|-------------|-------------|
| dht          | DHT               | —           | DHT22 sensor object (pin 4, type DHT22) |
| display      | Adafruit_SSD1306  | —           | OLED display object (128x64, I2C) |
| oledReady    | bool              | false       | True if the OLED initialized successfully |
| valid        | bool              | false       | True if the latest DHT read produced valid numbers |
| temperature  | float             | NAN         | Latest temperature reading in deg C |
| humidity     | float             | NAN         | Latest relative humidity reading in % |
| waterRaw     | int               | 0           | Averaged raw ADC value from the water sensor (0-4095) |
| waterPercent | int               | 0           | Water level mapped to 0-100% |
| status       | const char*       | "STARTING"  | Current human-readable system state |
| buzzerActive | bool              | false       | True when the system is in danger; drives buzzer pulsing |
| lastRead     | unsigned long     | 0           | millis() timestamp of the last sensor read |
| lastDisplay  | unsigned long     | 0           | millis() timestamp of the last display refresh |

---

## 4. Functions

| Name        | Parameters          | Returns | Description |
|-------------|---------------------|---------|-------------|
| drawEyes    | bool open           | void    | Draws the TANAW eyes (open or blinking) with text top/bottom |
| showSplash  | —                   | void    | Displays the eyes splash for 5 seconds with blinks |
| readSensors | —                   | void    | Reads sensors, computes state, sets LEDs/buzzer flag/status |
| drawScreen  | bool showPercentage | void    | Renders the live monitoring screen on the OLED |
| setup       | —                   | void    | Initializes pins, sensor, display; runs splash once |
| loop        | —                   | void    | Main cycle: timed sensor reads, buzzer pulsing, display refresh |

---

## 5. Conditions — Temperature States

The state is decided in `readSensors()` from the DHT read.
Only one state is active at a time.

| State              | Condition                               | GREEN | YELLOW | RED | Buzzer  | status text    |
|--------------------|-----------------------------------------|:-----:|:------:|:---:|:-------:|----------------|
| DHT ERROR          | `valid == false` (temp or humidity NaN) | OFF   | OFF    | ON  | OFF     | "DHT ERROR"    |
| NORMAL             | valid AND temp < 38.0                    | ON    | OFF    | OFF | OFF     | "NORMAL"       |
| TEMP WARNING       | valid AND 38.0 <= temp < 40.0            | OFF   | ON     | OFF | OFF     | "TEMP WARNING" |
| HIGH TEMP (danger) | valid AND temp >= 40.0                   | OFF   | OFF    | ON  | PULSING | "HIGH TEMP"    |

Evaluation order of the boolean flags:

```cpp
danger  = valid && temperature >= DANGER_TEMP;              // >= 40.0
warning = valid && temperature >= WARNING_TEMP && !danger;  // 38.0 - 39.9
normal  = valid && !warning && !danger;                     // < 38.0
```

---

## 6. Conditions — Other Behaviors

| Behavior             | Condition                        | Effect |
|----------------------|----------------------------------|--------|
| Water % calculation  | always in readSensors()          | `(waterRaw - 0) / (3000 - 0) x 100`, clamped 0-100 |
| Water % display blink| `(now / 500) % 2 == 0`           | Percentage shown half the time, hidden the other half |
| Buzzer pulse         | `buzzerActive && (now % 500 < 250)` | 2 kHz tone 250 ms ON / 250 ms OFF while in danger |
| Sensor read interval | `now - lastRead >= 2000`         | Reads sensors every 2 seconds |
| Display refresh      | `now - lastDisplay >= 100`       | Redraws screen every 100 ms (~10 fps) |
| Splash blink         | `t in 1500-1700ms or 3500-3700ms`| Eyes drawn closed (flat lines) during these windows |
| OLED guard           | `if (!oledReady) return;`        | Drawing functions skip if display didn't initialize |

---

## 7. Notes on Ranges

- WARNING band is 38.0 deg C up to (but not including) 40.0 deg C.
- DANGER is 40.0 deg C and above.
- The RED LED is shared: it turns on for both danger and DHT error,
  but the buzzer only sounds for danger (not for sensor error).
