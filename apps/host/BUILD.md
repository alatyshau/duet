# BUILD.md — Инструкции по сборке Duet Host

ЧТО: Инструкции по генерации иконок и сборке дистрибутивов.
ЗАЧЕМ: Быстрый референс для повторной сборки.
КТО ИСПОЛЬЗУЕТ: Разработчик при релизе.

---

## Генерация иконок

### Требования

| Файл | Размер | Формат | Назначение |
|------|--------|--------|------------|
| `build/icon.png` | 512×512+ | PNG | Источник для всех иконок |
| `build/icon.icns` | multi | ICNS | macOS app icon |
| `build/icon.ico` | multi | ICO | Windows app icon |
| `resources/trayTemplate.png` | 16×16 | PNG | macOS Menu Bar (чёрный силуэт) |
| `resources/trayTemplate@2x.png` | 32×32 | PNG | macOS Menu Bar Retina |
| `resources/tray.ico` | 16+32 | ICO | Windows system tray |

### Скрипт генерации (Python + Pillow)

```bash
python3 << 'EOF'
from PIL import Image, ImageDraw

# === Tray иконки (монохромные) ===
def create_tray_icon(size, output_path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    scale = size / 16
    r = int(4 * scale)
    cx1, cx2, cy = int(5.5 * scale), int(10.5 * scale), size // 2
    draw.ellipse([cx1-r, cy-r, cx1+r, cy+r], fill=(0, 0, 0, 255))
    draw.ellipse([cx2-r, cy-r, cx2+r, cy+r], fill=(0, 0, 0, 255))
    img.save(output_path, 'PNG')

create_tray_icon(16, 'resources/trayTemplate.png')
create_tray_icon(32, 'resources/trayTemplate@2x.png')

# === ICO файлы из основной иконки ===
icon = Image.open('build/icon.png')
icon.save('build/icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (256,256)])
icon.resize((32, 32), Image.Resampling.LANCZOS).save('resources/tray.ico', format='ICO', sizes=[(16,16), (32,32)])

print("Done!")
EOF
```

### ICNS для macOS (из icon.png)

```bash
# Создаём iconset
mkdir -p /tmp/Duet.iconset
for size in 16 32 128 256 512; do
  sips -z $size $size build/icon.png --out /tmp/Duet.iconset/icon_${size}x${size}.png
  [ $size -lt 512 ] && sips -z $((size*2)) $((size*2)) build/icon.png --out /tmp/Duet.iconset/icon_${size}x${size}@2x.png
done
cp /tmp/Duet.iconset/icon_512x512.png /tmp/Duet.iconset/icon_512x512@2x.png

# Конвертируем в ICNS
iconutil -c icns /tmp/Duet.iconset -o build/icon.icns
```

---

## Сборка дистрибутивов

### Команды

```bash
# Из корня монорепо
npm run build:host              # Только сборка (без упаковки)

# Из apps/host
npm run build:mac               # → dist/Duet-{version}.dmg
npm run build:win               # → dist/Duet-{version}-setup.exe
npm run build:linux             # → dist/Duet-{version}.AppImage
```

### Что создаётся

| Платформа | Файл | Примечание |
|-----------|------|------------|
| macOS | `Duet-0.1.0.dmg` | Установщик |
| macOS | `Duet-0.1.0-arm64-mac.zip` | Архив |
| Windows | `Duet-0.1.0-setup.exe` | NSIS installer |
| Linux | `Duet-0.1.0.AppImage` | Portable |

### Code Signing

- **macOS**: Требует Apple Developer ID. Без него — warning, но работает.
- **Windows**: Требует сертификат. Без него — SmartScreen warning.

Для production настроить:
- `CSC_LINK` / `CSC_KEY_PASSWORD` — сертификат
- `notarize: true` в electron-builder.yml для macOS

---

## Версионирование

Версия берётся из `package.json`. Перед релизом:

```bash
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.0 → 0.2.0
npm version major  # 0.1.0 → 1.0.0
```
