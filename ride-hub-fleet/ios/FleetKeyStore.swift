import Foundation

struct FleetScooterKey: Identifiable, Codable, Hashable {
    let id: String
    let secretHex: String
    let displayName: String
}

final class FleetKeyStore: ObservableObject {
    @Published private(set) var scooters: [FleetScooterKey] = [
        FleetScooterKey(
            id: "RH-0001",
            secretHex: "1122334455667788901020304050607081828384858687889192939495969798",
            displayName: "Самокат 1"
        )
    ]

    func key(for deviceId: String) -> FleetScooterKey? {
        scooters.first { $0.id == deviceId }
    }

    func add(_ key: FleetScooterKey) {
        scooters.removeAll { $0.id == key.id }
        scooters.append(key)
    }
}

extension Data {
    init?(hex: String) {
        let clean = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count % 2 == 0 else { return nil }
        var out = Data(capacity: clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            out.append(byte)
            index = next
        }
        self = out
    }

    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
