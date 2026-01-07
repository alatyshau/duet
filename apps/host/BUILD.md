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

# === Базовая tray иконка (два кружка - логотип Duet) ===
def draw_duet_logo(draw, size):
    """Рисует логотип Duet (два кружка) на draw контексте"""
    scale = size / 16
    r = int(4 * scale)
    cx1, cx2, cy = int(5.5 * scale), int(10.5 * scale), size // 2
    draw.ellipse([cx1-r, cy-r, cx1+r, cy+r], fill=(0, 0, 0, 255))
    draw.ellipse([cx2-r, cy-r, cx2+r, cy+r], fill=(0, 0, 0, 255))

def create_tray_icon(size, output_path, warning=False):
    """Создаёт tray иконку. warning=True добавляет badge в правом верхнем углу."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_duet_logo(draw, size)

    if warning:
        # macOS Template: badge как чёрный кружок с белым центром (выглядит как кольцо)
        # Располагаем в правом верхнем углу
        scale = size / 16
        badge_r = int(2.5 * scale)
        badge_cx = size - badge_r - 1
        badge_cy = badge_r + 1
        # Внешний чёрный круг
        draw.ellipse([badge_cx-badge_r, badge_cy-badge_r, badge_cx+badge_r, badge_cy+badge_r], fill=(0, 0, 0, 255))
        # Внутренний белый (прозрачный) круг - создаёт эффект кольца
        inner_r = int(1 * scale)
        draw.ellipse([badge_cx-inner_r, badge_cy-inner_r, badge_cx+inner_r, badge_cy+inner_r], fill=(0, 0, 0, 0))

    img.save(output_path, 'PNG')

# Normal tray иконки
create_tray_icon(16, 'resources/trayTemplate.png', warning=False)
create_tray_icon(32, 'resources/trayTemplate@2x.png', warning=False)

# Warning tray иконки (с badge)
create_tray_icon(16, 'resources/trayWarningTemplate.png', warning=True)
create_tray_icon(32, 'resources/trayWarningTemplate@2x.png', warning=True)

# === Windows tray ICO (с цветным badge для warning) ===
def create_windows_tray(size, warning=False):
    """Создаёт Windows tray иконку."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Логотип (серый для Windows, чтобы был виден на светлом и тёмном)
    scale = size / 16
    r = int(4 * scale)
    cx1, cx2, cy = int(5.5 * scale), int(10.5 * scale), size // 2
    gray = (100, 100, 100, 255)
    draw.ellipse([cx1-r, cy-r, cx1+r, cy+r], fill=gray)
    draw.ellipse([cx2-r, cy-r, cx2+r, cy+r], fill=gray)

    if warning:
        # Жёлтый/оранжевый badge в правом верхнем углу
        badge_r = int(3 * scale)
        badge_cx = size - badge_r - 1
        badge_cy = badge_r + 1
        orange = (255, 165, 0, 255)
        draw.ellipse([badge_cx-badge_r, badge_cy-badge_r, badge_cx+badge_r, badge_cy+badge_r], fill=orange)

    return img

# Windows normal tray
img16 = create_windows_tray(16, warning=False)
img32 = create_windows_tray(32, warning=False)
img16.save('resources/tray.ico', format='ICO', sizes=[(16,16)])
# Для лучшего качества нужно несколько размеров
img32.save('/tmp/tray32.png')
img16.save('/tmp/tray16.png')

# Windows warning tray
img16w = create_windows_tray(16, warning=True)
img32w = create_windows_tray(32, warning=True)
img16w.save('resources/tray-warning.ico', format='ICO', sizes=[(16,16)])

# === ICO файлы из основной иконки ===
icon = Image.open('build/icon.png')
icon.save('build/icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (256,256)])

print("Done! Created:")
print("  resources/trayTemplate.png")
print("  resources/trayTemplate@2x.png")
print("  resources/trayWarningTemplate.png")
print("  resources/trayWarningTemplate@2x.png")
print("  resources/tray.ico")
print("  resources/tray-warning.ico")
EOF
```

### Что генерируется

| Файл | Назначение |
|------|------------|
| `trayTemplate.png` | macOS Menu Bar (normal) |
| `trayTemplate@2x.png` | macOS Retina (normal) |
| `trayWarningTemplate.png` | macOS Menu Bar (warning badge) |
| `trayWarningTemplate@2x.png` | macOS Retina (warning badge) |
| `tray.ico` | Windows tray (normal) |
| `tray-warning.ico` | Windows tray (warning badge) |

**Примечание**: macOS Template иконки всегда монохромные — система сама меняет цвет под тему. Badge реализован как кольцо (чёрный круг с прозрачным центром).

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
