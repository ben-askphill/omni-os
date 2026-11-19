# Apple's Developer ID intermediates

The release workflow's sign job loads these into its signing keychain beside the Developer ID, so codesign can build the chain up to Apple Root CA (`.github/workflows/desktop-release.yml`). They are public, from [apple.com/certificateauthority](https://www.apple.com/certificateauthority/).

| File | Certificate | Expires | SHA-256 |
| --- | --- | --- | --- |
| `DeveloperIDG2CA.cer` | Developer ID Certification Authority, G2 | 2031-09-17 | `F1:6C:D3:C5:4C:7F:83:CE:A4:BF:1A:3E:6A:08:19:C8:AA:A8:E4:A1:52:8F:D1:44:71:5F:35:06:43:D2:DF:3A` |
| `DeveloperIDCA.cer` | Developer ID Certification Authority | 2027-02-01 | `7A:FC:9D:01:A6:2F:03:A2:DE:96:37:93:6D:4A:FE:68:09:0D:2D:E1:8D:03:F2:9C:88:CF:B0:B1:BA:63:58:7F` |

Check a file with `openssl x509 -inform DER -in <file> -noout -subject -issuer -fingerprint -sha256`.
