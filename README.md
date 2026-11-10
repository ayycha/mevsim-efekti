# ❄️🍂 MevsimEfekti

Bilgisayarınızın masaüstüne **kar** ya da **sonbahar yaprakları** yağdıran ücretsiz uygulama.
Windows, macOS ve Linux için.

- ❄️ Kar yağar, yerde ve açık pencerelerin üst kenarında **birikir** (belli bir seviyeden fazla yükselmez).
- ⚪ Birikmiş karın üstünde fareyi **yavaş** gezdirirseniz **kartopu** yuvarlanır ve büyür.
- 💨 Fareyi **hızlı** geçirirseniz kar uçar, kartopunu fırlatabilirsiniz.
- 🪟 *(Windows)* Açık pencerelerin üst kenarında da kar birikir; bir pencereyi sürüklerseniz üstündeki kar **savrulur**.
- 🍂 Sonbahar modunda renkli yapraklar yağar ve yerde birikir.
- 🖱️ Tıklamaları engellemez, normal çalışmaya devam edebilirsiniz.
- ⚙️ Yoğunluk, yağış hızı ve saydamlık ayarlanabilir. İsterseniz bilgisayar açılınca kendiliğinden başlar.

---

## 📥 İndirme

### 👉 [**İNDİRMEK İÇİN TIKLAYIN**](https://github.com/ayycha/mevsim-efekti/releases/latest)

Açılan sayfada aşağı inip **Assets** bölümünden sisteminize uygun dosyayı indirin:

| Sisteminiz | İndirilecek dosya |
| --- | --- |
| 🪟 Windows 10 / 11 | `MevsimEfekti-Setup-....exe` |
| 🍎 Mac (M1, M2, M3... işlemci) | `MevsimEfekti-...-mac-arm64.dmg` |
| 🍎 Mac (Intel işlemci) | `MevsimEfekti-...-mac-x64.dmg` |
| 🐧 Linux | `MevsimEfekti-...-linux.AppImage` |

> Hangi Mac'e sahip olduğunuzu bilmiyorsanız: Apple menüsü → **Bu Mac Hakkında**. "Çip: Apple M..." yazıyorsa arm64, "İşlemci: Intel" yazıyorsa x64 dosyasını indirin.

---

## 🛠️ Kurulum

### Windows
1. `.exe` dosyasına çift tıklayın, kurulum kendiliğinden biter.
2. **"Windows bilgisayarınızı korudu"** uyarısı çıkarsa **Ek bilgi → Yine de çalıştır** deyin. (Uygulama imzasız olduğu için çıkar, zararlı değildir.)
3. Ekrana kar yağmaya başlar. Sağ alttaki simge (gizli simgeler `^` okunun içinde olabilir) menüyü açar.

#### 🛡️ İndirirken "virüs / zararlı olabilir" uyarısı çıkarsa

Bu uygulama **açık kaynaklıdır**, kodun tamamı bu sayfada herkesin okuyabileceği şekilde durur. Uyarı, uygulamanın henüz dijital olarak **imzalanmamış** ve yeni olmasından kaynaklanır. Yine de indirmek isterseniz:

- **Chrome:** İndirilenler listesinde dosyanın yanındaki **⋮** → **Sakla (Keep)** deyin.
- **Edge:** İndirilenler penceresinde dosyanın yanındaki **⋯** → **Sakla (Keep)** → **Yine de sakla** deyin.
- **Windows Defender / SmartScreen:** **Ek bilgi → Yine de çalıştır** deyin.
- Güvenlik programınız dosyayı silerse, dosyayı **izin verilenler / dışlamalar** listesine ekleyin.

Dosyanın güvenliğinden emin olmak için [virustotal.com](https://www.virustotal.com) adresine yükleyip birçok antivirüs motoruyla taratabilirsiniz.

### macOS
1. `.dmg` dosyasını açın, uygulamayı **Applications (Uygulamalar)** klasörüne sürükleyin.
2. İlk açılışta uyarı çıkarsa uygulamaya **sağ tık → Aç** deyin.
3. Hâlâ "hasarlı" derse Terminal'e şunu yazın: `xattr -cr /Applications/MevsimEfekti.app`
4. Menü çubuğundaki (sağ üst) simgeden ayarları açın.

### Linux
1. `.AppImage` dosyasına sağ tık → Özellikler → **Program olarak çalıştırılabilir** işaretleyin (ya da `chmod +x dosya.AppImage`).
2. Çift tıklayıp çalıştırın. Şeffaflık için compositor'lı bir masaüstü gerekir.

---

## 🎮 Nasıl kullanılır?

Simgeye (Windows'ta sağ alt, Mac'te sağ üst) tıklayın:

- **Kar / Sonbahar yaprakları**: efekti seçin
- **Yoğunluk, Yağış hızı, Saydamlık**: istediğiniz gibi ayarlayın
- **Yerde birikme**: kapatırsanız kar/yaprak birikmez
- **Fareyle etkileşim**: kartopu yuvarlama ve kar uçurmayı açıp kapatır
- **Pencerelerin kenarında biriksin** (Windows): açık pencerelerin üstünde birikmeyi açıp kapatır
- **Duraklat**: efekti geçici olarak gizler
- **Bilgisayar açılınca başlat**: açılışta otomatik çalışır
- **Çıkış**: uygulamayı kapatır

**Kartopu yuvarlamak için:** Birikmiş karın üstünde fareyi yavaşça gezdirin (yaklaşık yarım saniye). Fare kartopuna dönüşür, sürükledikçe büyür. Fareyi yığından uzaklaştırınca top yerinde kalır. Fareyi hızlıca sürterseniz top fırlar.

---

## ❓ Sık sorulanlar

**Simge görünmüyor.** Windows'ta saatin yanındaki `^` okuna bakın.

**Nasıl kaldırırım?** Önce simgeden **Çıkış** deyin. Windows'ta Ayarlar → Uygulamalar → MevsimEfekti → Kaldır. Mac'te uygulamayı çöpe atın.

**Bilgisayarı yavaşlatır mı?** Yoğunluğu **Az** yapabilirsiniz, yağış hızını düşürebilirsiniz.

---

## 👩‍💻 Geliştiriciler için

```bash
npm install
npm start
```

Ayarlar `renderer.js` dosyasının en üstündeki **AYARLAR** bölümündedir (kar yığını yüksekliği, kartopu boyutu, fare hassasiyeti, parçacık sayıları, yaprak renkleri).

Yeni sürüm yayınlamak için `package.json` içindeki `version` değerini artırıp şunları yazın:

```bash
git tag v1.1.1
git push --tags
```

GitHub Actions, Windows/Mac/Linux kurulum dosyalarını kendiliğinden derleyip **Releases** sayfasına koyar.

---

📄 Lisans: MIT
