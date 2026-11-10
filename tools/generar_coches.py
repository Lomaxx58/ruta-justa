#!/usr/bin/env python3
"""
Genera ../coches.json con el consumo homologado (WLTP) de los coches
matriculados, a partir de los datos oficiales de la Agencia Europea de
Medio Ambiente (EEA, "Monitoring of CO2 emissions from passenger cars").

Uso:
  python generar_coches.py                  # descarga de Discodata (EEA), solo coches matriculados en España
  python generar_coches.py --pais todos     # toda la UE (muchísimas filas: tarda bastante)
  python generar_coches.py --tabla co2cars_2025Pv31
  python generar_coches.py --csv datos.csv  # si prefieres bajar el CSV a mano desde la web de la EEA

Solo usa la biblioteca estándar de Python 3.8+.
"""
import argparse, csv, json, re, statistics, sys, unicodedata, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

DISCODATA = "https://discodata.eea.europa.eu/sql"
TABLA_POR_DEFECTO = "co2cars_2025Pv31"
MIN_REGISTROS = 15          # descarta combinaciones con muy pocas matriculaciones (datos ruidosos)
SALIDA = Path(__file__).resolve().parent.parent / "coches.json"


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


# Nombres de columna conocidos (cambian ligeramente entre años): se buscan por coincidencia normalizada.
CANDIDATAS = {
    "marca":  ["mk", "make"],
    "modelo": ["cn", "commercialname"],
    "ft":     ["ft", "fueltype"],
    "fm":     ["fm", "fuelmode"],
    "kw":     ["epkw", "ep", "enginepower"],
    "fc":     ["fuelconsumption", "fc"],
    "z":      ["zwhkm", "z", "electricenergyconsumption"],
    "pais":   ["ms", "country", "memberstate"],
    "r":      ["r", "registrations"],
}


def mapear_columnas(columnas):
    idx = {norm(c): c for c in columnas}
    res = {}
    for clave, opciones in CANDIDATAS.items():
        for o in opciones:
            if o in idx:
                res[clave] = idx[o]
                break
    faltan = [k for k in ("marca", "modelo", "ft", "fc", "z") if k not in res]
    if faltan:
        sys.exit(f"No encuentro las columnas {faltan}. Columnas disponibles: {columnas}")
    return res


def tipo_de(ft, fm):
    ft, fm = norm(ft), norm(fm or "")
    if ft == "electric":
        return "electrico"
    if fm == "p":                        # híbrido enchufable: su consumo homologado no sirve para viajes
        return None
    if fm == "h" or "electric" in ft:    # híbrido no enchufable (Fm = H)
        return "hibrido"
    if ft == "petrol":
        return "gasolina"
    if ft == "diesel":
        return "diesel"
    if ft == "lpg":
        return "glp"
    return None                          # GNC, E85, hidrógeno... se dejan fuera


def bonito(texto):
    t = re.sub(r"\s+", " ", str(texto)).strip()
    return " ".join(p if (len(p) <= 3 and p.isupper()) or any(ch.isdigit() for ch in p) else p.capitalize()
                    for p in t.split(" "))


def sin_marca(marca, modelo):
    m, mod = str(marca).strip(), str(modelo).strip()
    return mod[len(m) + 1:] if mod.upper().startswith(m.upper() + " ") else mod


def a_float(v):
    try:
        f = float(str(v).replace(",", "."))
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def discodata(sql, pagina=1, por_pagina=10000):
    url = f"{DISCODATA}?query={urllib.parse.quote(sql)}&p={pagina}&nrOfHits={por_pagina}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ruta-justa)"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["results"]


def desde_discodata(tabla, pais):
    # El cortafuegos de Discodata rechaza (403) las consultas con alias, SUM/AVG o GROUP BY,
    # así que se descargan las filas por páginas y se agregan aquí.
    print(f"Leyendo columnas de [CO2Emission].[latest].[{tabla}]…")
    muestra = discodata(f"SELECT TOP 1 * FROM [CO2Emission].[latest].[{tabla}]", 1, 1)
    if not muestra:
        sys.exit("La tabla está vacía o no existe. Prueba con --tabla <nombre>.")
    c = mapear_columnas(list(muestra[0].keys()))
    claves = [k for k in ("marca", "modelo", "ft", "fm", "kw", "fc", "z", "r") if k in c]
    cols = ", ".join(f"[{c[k]}]" for k in claves)
    donde = f" WHERE [{c['pais']}] = '{pais}'" if pais != "todos" and "pais" in c else ""
    sql = f"SELECT {cols} FROM [CO2Emission].[latest].[{tabla}]{donde}"
    grupos = defaultdict(lambda: {"fc": 0.0, "nfc": 0, "z": 0.0, "nz": 0, "n": 0})
    pagina, total = 1, 0
    while True:
        filas = discodata(sql, pagina)
        for f in filas:
            g = lambda k: f.get(c[k]) if k in c else None
            kwv = a_float(g("kw"))
            n = int(a_float(g("r")) or 1)
            gr = grupos[(g("marca"), g("modelo"), g("ft"), g("fm"), round(kwv, -1) if kwv else None)]
            gr["n"] += n
            if (v := a_float(g("fc"))): gr["fc"] += v * n; gr["nfc"] += n
            if (v := a_float(g("z"))): gr["z"] += v * n; gr["nz"] += n
        total += len(filas)
        print(f"  página {pagina}: {total:,} filas", end="\r", flush=True)
        if len(filas) < 10000:
            break
        pagina += 1
    print()
    return [{"marca": k[0], "modelo": k[1], "ft": k[2], "fm": k[3], "kw": k[4],
             "fc": g["fc"] / g["nfc"] if g["nfc"] else None,
             "z": g["z"] / g["nz"] if g["nz"] else None, "n": g["n"]} for k, g in grupos.items()]


def desde_csv(ruta, pais):
    print(f"Leyendo {ruta}…")
    with open(ruta, newline="", encoding="utf-8", errors="replace") as f:
        dialecto = csv.Sniffer().sniff(f.read(20000), delimiters=",;\t")
        f.seek(0)
        lector = csv.DictReader(f, dialect=dialecto)
        c = mapear_columnas(lector.fieldnames)
        grupos = defaultdict(lambda: {"fc": [], "z": [], "n": 0})
        for fila in lector:
            if pais != "todos" and "pais" in c and fila.get(c["pais"]) != pais:
                continue
            kwv = a_float(fila.get(c.get("kw", ""), None))
            k = (fila[c["marca"]], fila[c["modelo"]], fila[c["ft"]], fila.get(c.get("fm", ""), ""),
                 round(kwv, -1) if kwv else None)
            g = grupos[k]
            g["n"] += int(a_float(fila.get(c.get("r", ""), None)) or 1)
            if (v := a_float(fila.get(c["fc"]))): g["fc"].append(v)
            if (v := a_float(fila.get(c["z"]))): g["z"].append(v)
    return [{"marca": k[0], "modelo": k[1], "ft": k[2], "fm": k[3], "kw": k[4],
             "fc": statistics.median(g["fc"]) if g["fc"] else None,
             "z": statistics.median(g["z"]) if g["z"] else None, "n": g["n"]} for k, g in grupos.items()]


def construir(filas):
    coches = {}
    for f in filas:
        tipo = tipo_de(f.get("ft"), f.get("fm"))
        if not tipo or not f.get("marca") or not f.get("modelo") or (f.get("n") or 0) < MIN_REGISTROS:
            continue
        if tipo == "electrico":
            z = a_float(f.get("z"))
            mixto = z / 10 if z else None            # Wh/km -> kWh/100 km
            if not mixto or not 8 <= mixto <= 40: continue
        else:
            mixto = a_float(f.get("fc"))             # l/100 km
            if not mixto or not 2 <= mixto <= 25: continue
        kw = int(f["kw"]) if a_float(f.get("kw")) else None
        modelo = sin_marca(f["marca"], f["modelo"])
        clave = (norm(f["marca"]), norm(modelo), tipo, kw)
        prev = coches.get(clave)
        n = int(f["n"])
        if prev:  # une variantes escritas distinto, ponderando por matriculaciones
            tot = prev[5] + n
            prev[4] = round((prev[4] * prev[5] + mixto * n) / tot, 1)
            prev[5] = tot
        else:
            coches[clave] = [bonito(f["marca"]), bonito(modelo), tipo, kw, round(mixto, 1), n]
    lista = sorted(coches.values(), key=lambda c: (-c[5], c[0], c[1]))
    return lista


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tabla", default=TABLA_POR_DEFECTO)
    ap.add_argument("--pais", default="ES", help="Código de país (ES, PT, FR…) o 'todos'")
    ap.add_argument("--csv", help="Usar un CSV descargado a mano en lugar de Discodata")
    a = ap.parse_args()
    filas = desde_csv(a.csv, a.pais) if a.csv else desde_discodata(a.tabla, a.pais)
    coches = construir(filas)
    datos = {
        "fuente": f"EEA, Monitoring of CO2 emissions from passenger cars ({a.csv or a.tabla}), país: {a.pais}",
        "formato": ["marca", "modelo", "tipo", "kW", "consumo mixto WLTP (l o kWh /100 km)", "matriculaciones"],
        "coches": coches,
    }
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Listo: {len(coches)} versiones de coche guardadas en {SALIDA} ({SALIDA.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
