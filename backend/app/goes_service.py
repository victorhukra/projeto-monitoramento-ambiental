import json
import math
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import xarray as xr
from PIL import Image, ImageDraw

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "goes"
TZ = ZoneInfo("America/Sao_Paulo")
LAT, LON, HALF_DEG = -23.31, -51.16, 4.0
BUCKETS = {"G16": "noaa-goes16", "G19": "noaa-goes19"}
_NAME_RE = re.compile(r"_(G\d+)_s(\d{13})")


class GoesImageError(Exception):
    pass


#pergunta ao banco qual é o image_link da linha daquele horário. Esse caminho só serve para descobrir qual varredura do satélite corresponde ao horário.
def _image_link(t):
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    local = t.astimezone(TZ).replace(tzinfo=None)
    q = urllib.parse.urlencode({
        "select": "image_link",
        "time": f"eq.{local:%Y-%m-%dT%H:%M:%S}",
        "limit": "1",
    })
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/dataset_weather_goes?{q}",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read())
    if not rows or not rows[0].get("image_link"):
        raise GoesImageError("Sem imagem GOES registrada para este horário.")
    return rows[0]["image_link"]

#lê o nome do arquivo e extrai dois dados: qual satélite (GOES-16 ou GOES-19) e a hora exata da varredura em UTC.
def _parse_link(link):
    m = _NAME_RE.search(link)
    if not m or m.group(1) not in BUCKETS:
        raise GoesImageError("Nome de arquivo GOES não reconhecido.")
    scan = datetime.strptime(m.group(2), "%Y%j%H%M%S").replace(tzinfo=timezone.utc)
    return BUCKETS[m.group(1)], scan

#procura no bucket público da NOAA o arquivo do canal infravermelho (C13) dessa varredura.
def _find_key(bucket, scan):
    prefix = f"ABI-L2-CMIPF/{scan:%Y}/{scan.timetuple().tm_yday:03d}/{scan:%H}/"
    url = f"https://{bucket}.s3.amazonaws.com/?list-type=2&prefix={urllib.parse.quote(prefix)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        root = ET.fromstring(r.read())
    best, best_diff = None, None
    for el in root.iter():
        if not el.tag.endswith("Key"):
            continue
        m = re.search(r"M\dC13_G\d+_s(\d{13})", el.text or "")
        if not m:
            continue
        s = datetime.strptime(m.group(1), "%Y%j%H%M%S").replace(tzinfo=timezone.utc)
        diff = abs(s - scan)
        if diff <= timedelta(minutes=2) and (best is None or diff < best_diff):
            best, best_diff = el.text, diff
    if best is None:
        raise GoesImageError("Imagem não encontrada na NOAA para este horário.")
    return best

#converte latitude e longitude em posição dentro da imagem do satélite. Serve para recortar só a região de Londrina e para saber onde desenhar o marcador.
def _xy(lat, lon, proj):
    req, rpol = proj["semi_major_axis"], proj["semi_minor_axis"]
    H = proj["perspective_point_height"] + req
    lam0 = math.radians(proj["longitude_of_projection_origin"])
    e2 = (req**2 - rpol**2) / req**2
    phi, lam = math.radians(lat), math.radians(lon)
    phi_c = math.atan((rpol**2 / req**2) * math.tan(phi))
    rc = rpol / math.sqrt(1 - e2 * math.cos(phi_c) ** 2)
    sx = H - rc * math.cos(phi_c) * math.cos(lam - lam0)
    sy = -rc * math.cos(phi_c) * math.sin(lam - lam0)
    sz = rc * math.sin(phi_c)
    return math.asin(-sy / math.sqrt(sx**2 + sy**2 + sz**2)), math.atan(sz / sx)

#recorta Londrina, transforma a temperatura das nuvens em cores, desenha a grade de graus e o marcador “Londrina” e salva o PNG.
def _render(nc_path, out_path):
    ds = xr.open_dataset(nc_path, engine="h5netcdf")
    proj = ds["goes_imager_projection"].attrs
    corners = [_xy(LAT + a * HALF_DEG, LON + b * HALF_DEG, proj) for a in (-1, 1) for b in (-1, 1)]
    xmin, xmax = min(c[0] for c in corners), max(c[0] for c in corners)
    ymin, ymax = min(c[1] for c in corners), max(c[1] for c in corners)
    xs, ys = ds["x"].values, ds["y"].values
    ix = np.where((xs >= xmin) & (xs <= xmax))[0]
    iy = np.where((ys >= ymin) & (ys <= ymax))[0]
    bt = ds["CMI"].isel(x=slice(ix[0], ix[-1] + 1), y=slice(iy[0], iy[-1] + 1)).values

    gray = np.nan_to_num(np.clip((310 - bt) / (310 - 190), 0, 1))
    img = Image.fromarray((gray * 255).astype("uint8")).convert("RGB")
    scale = 3
    img = img.resize((img.width * scale, img.height * scale), Image.Resampling.BILINEAR)

    cx, cy = _xy(LAT, LON, proj)
    px = (int(np.argmin(np.abs(xs[ix] - cx))) + 0.5) * scale
    py = (int(np.argmin(np.abs(ys[iy] - cy))) + 0.5) * scale
    ImageDraw.Draw(img).ellipse([px - 6, py - 6, px + 6, py + 6], outline=(255, 60, 60), width=2)
    img.save(out_path, "PNG")
    ds.close()

#coordena tudo isso e usa o cache.
def get_goes_png(reference_time):
    link = _image_link(reference_time)
    bucket, scan = _parse_link(link)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"{scan:%Y%m%dT%H%M%S}_C13.png"
    if out.exists():
        return out
    key = _find_key(bucket, scan)
    with tempfile.TemporaryDirectory() as tmp:
        nc = Path(tmp) / "goes.nc"
        with urllib.request.urlopen(
            f"https://{bucket}.s3.amazonaws.com/{urllib.parse.quote(key)}", timeout=120
        ) as r, open(nc, "wb") as f:
            shutil.copyfileobj(r, f)
        _render(nc, out)
    return out