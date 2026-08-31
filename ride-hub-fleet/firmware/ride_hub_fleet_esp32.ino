#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <mbedtls/md.h>
#include <esp_system.h>
#include <time.h>

static const char* DEVICE_ID = "RH-0001";
static const uint8_t DEVICE_SECRET[32] = {
  0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,
  0x90,0x10,0x20,0x30,0x40,0x50,0x60,0x70,
  0x81,0x82,0x83,0x84,0x85,0x86,0x87,0x88,
  0x91,0x92,0x93,0x94,0x95,0x96,0x97,0x98
};

static const int LOCK_PIN = 26;
static const int UNLOCK_PULSE_MS = 800;

#define SERVICE_UUID   "8f2a0001-9c5b-4a6e-9d51-22c3dbe00001"
#define DEVICE_UUID    "8f2a0002-9c5b-4a6e-9d51-22c3dbe00001"
#define CHALLENGE_UUID "8f2a0003-9c5b-4a6e-9d51-22c3dbe00001"
#define COMMAND_UUID   "8f2a0004-9c5b-4a6e-9d51-22c3dbe00001"
#define STATE_UUID     "8f2a0005-9c5b-4a6e-9d51-22c3dbe00001"

BLECharacteristic* challengeChar;
BLECharacteristic* stateChar;
String challengeHex;
bool challengeUsed = false;

String toHex(const uint8_t* data, size_t len) {
  static const char* h = "0123456789abcdef";
  String out; out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += h[(data[i] >> 4) & 0xF];
    out += h[data[i] & 0xF];
  }
  return out;
}

String hmacHex(const String& payload) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, DEVICE_SECRET, sizeof(DEVICE_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)payload.c_str(), payload.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  return toHex(out, sizeof(out));
}

void newChallenge() {
  uint8_t bytes[16];
  for (int i = 0; i < 16; i += 4) {
    uint32_t r = esp_random();
    memcpy(bytes + i, &r, 4);
  }
  challengeHex = toHex(bytes, sizeof(bytes));
  challengeUsed = false;
  challengeChar->setValue(challengeHex.c_str());
  challengeChar->notify();
}

void setState(const char* value) {
  stateChar->setValue(value);
  stateChar->notify();
}

void pulseUnlock() {
  digitalWrite(LOCK_PIN, HIGH);
  delay(UNLOCK_PULSE_MS);
  digitalWrite(LOCK_PIN, LOW);
}

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    std::string raw = characteristic->getValue();
    String s(raw.c_str());
    int p1 = s.indexOf('|');
    int p2 = s.indexOf('|', p1 + 1);
    int p3 = s.indexOf('|', p2 + 1);
    int p4 = s.indexOf('|', p3 + 1);
    if (p1 < 0 || p2 < 0 || p3 < 0 || p4 < 0) { setState("BAD_FORMAT"); return; }

    String action = s.substring(0, p1);
    String device = s.substring(p1 + 1, p2);
    String challenge = s.substring(p2 + 1, p3);
    String tsStr = s.substring(p3 + 1, p4);
    String sig = s.substring(p4 + 1);

    if (action != "UNLOCK") { setState("BAD_ACTION"); return; }
    if (device != DEVICE_ID) { setState("BAD_DEVICE"); return; }
    if (challengeUsed || challenge != challengeHex) { setState("BAD_CHALLENGE"); return; }

    long now = time(nullptr);
    long ts = tsStr.toInt();
    if (now > 100000 && labs(now - ts) > 30) { setState("STALE"); return; }

    String payload = action + "|" + device + "|" + challenge + "|" + tsStr;
    String expected = hmacHex(payload);
    sig.toLowerCase();
    if (sig != expected) { setState("BAD_HMAC"); return; }

    challengeUsed = true;
    setState("UNLOCKING");
    pulseUnlock();
    setState("OPEN");
    delay(200);
    newChallenge();
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { setState("CONNECTED"); newChallenge(); }
  void onDisconnect(BLEServer* server) override {
    setState("IDLE");
    server->getAdvertising()->start();
  }
};

void setup() {
  pinMode(LOCK_PIN, OUTPUT);
  digitalWrite(LOCK_PIN, LOW);

  BLEDevice::init((String("RideHub-") + DEVICE_ID).c_str());
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* deviceChar = service->createCharacteristic(DEVICE_UUID, BLECharacteristic::PROPERTY_READ);
  deviceChar->setValue(DEVICE_ID);

  challengeChar = service->createCharacteristic(CHALLENGE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  challengeChar->addDescriptor(new BLE2902());

  BLECharacteristic* commandChar = service->createCharacteristic(COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  commandChar->setCallbacks(new CommandCallbacks());

  stateChar = service->createCharacteristic(STATE_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  stateChar->addDescriptor(new BLE2902());
  stateChar->setValue("IDLE");

  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();
  newChallenge();
}

void loop() {
  delay(1000);
}
