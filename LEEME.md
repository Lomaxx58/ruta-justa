# Ruta Justa (app móvil instalable)

App web progresiva (PWA): se instala en Android y iPhone desde el navegador, sin tiendas de apps.

## 1. Cargar los consumos oficiales de todos los coches
`coches.json` ya trae los datos oficiales de 2025 (≈1.160 versiones matriculadas en España).
Para actualizarlo más adelante, haz doble clic en `tools/generar_coches.bat` (necesitas Python 3.8+)
o, desde la carpeta `tools/`:

    python generar_coches.py            # coches matriculados en España
    python generar_coches.py --pais todos

Sobrescribe `coches.json` con el consumo homologado WLTP de cada versión (marca, modelo,
combustible y potencia), sacado de los datos oficiales de la Agencia Europea de Medio Ambiente.
Si la descarga falla, baja el CSV desde la web de la EEA ("CO2 emissions from new passenger cars")
y usa `python generar_coches.py --csv archivo.csv`.

## 2. Probar en el ordenador
    python -m http.server 8000      # y abre http://localhost:8000

## 3. Publicarla gratis para ti y tu amigo (GitHub Pages)
1. Crea un repositorio en GitHub y sube todo el contenido de esta carpeta.
2. Settings > Pages > Source: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
3. En un par de minutos tendrás la app en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.

## 4. Instalarla en el móvil
- Android (Chrome): abre el enlace > menú ⋮ > "Instalar aplicación".
- iPhone (Safari): abre el enlace > botón Compartir > "Añadir a pantalla de inicio".

Cada móvil guarda sus propios coches y precios.

## Actualizar
Sube los cambios al repositorio. Si cambias archivos, sube el número de versión en `sw.js`
(`ruta-justa-v1` → `ruta-justa-v2`) para que los móviles descarguen la versión nueva.

## Si algún día quieres un APK
Con la app ya publicada, pwabuilder.com genera un APK de Android a partir de la URL.
