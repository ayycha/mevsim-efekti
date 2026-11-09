# MevsimEfekti

Windows, macOS ve Linux için ücretsiz masaüstü efektleri: ❄️ kar ve 🍂 sonbahar yaprakları.

- Kar yerde birikir (sınırlı), birikince kartopları yuvarlanır ve büyüyünce parçalanır.
- Yapraklar yere düşüp küçük bir yığın oluşturur.
- Tıklamaları engellemez; normal çalışmaya devam edebilirsiniz.
- Menü çubuğu / sistem tepsisi simgesinden efekt, yoğunluk, yağış hızı, saydamlık ve birikme ayarlanır.
- İsterseniz bilgisayar açılınca otomatik başlar.

## 📥 İndirme

Son sürüm: **https://github.com/ayycha/mevsim-efekti/releases/latest**

| Sistem | Dosya |
| --- | --- |
| Windows 10 / 11 | `MevsimEfekti-Setup-x.x.x.exe` |
| macOS (Apple Silicon: M1/M2/M3...) | `MevsimEfekti-x.x.x-mac-arm64.dmg` |
| macOS (Intel) | `MevsimEfekti-x.x.x-mac-x64.dmg` |
| Linux | `MevsimEfekti-x.x.x-linux.AppImage` |

## Nasıl kurulur?

1. Yukarıdaki bağlantıdan **Assets** bölümünü açın.
2. Sisteminize uygun dosyayı indirin.
3. Çalıştırıp kurun.
4. Sağ üstteki (Mac) veya sağ alttaki (Windows) simgeden efekti seçin.

> macOS "hasarlı" derse: Terminal'e `xattr -cr /Applications/MevsimEfekti.app` yazın.
> Windows SmartScreen uyarısında "Ek bilgi → Yine de çalıştır" deyin.

## Geliştirme

```bash
npm install
npm start
```
