# neufox's Node Viewer

Interactive map viewer for GTA San Andreas path nodes. Click any node to see its connections to adjacent nodes.

Available in English and Português (Brasil): it follows your browser language, and the **EN / PT** picker in the top bar switches it.

## What are path nodes?

GTA SA uses a system of 64 `NODES*.DAT` files (one per 750×750 unit sector) to define where vehicles and pedestrians can drive/walk. Each node is a point in 3D space; connections between nodes form the road/path network the game uses for navigation.

This viewer lets you explore that network visually, useful for understanding how NPC routing works, debugging NPC paths on your server, or just curiosity.

## Node colors (vehicle)

| Color | Type |
|-------|------|
| Green | Regular road |
| Blue | Highway |
| Red | Emergency vehicles only |
| Cyan | Boat / water |
| Yellow | Parking |
| Purple | Ped path |

## Data

Node data extracted from the SA `NODES0.DAT`–`NODES63.DAT` files using `extract.py`. Format documented at [GTAMods Wiki – Paths (GTA SA)](https://gtamods.com/wiki/Paths_(GTA_SA)).

## Running locally

```bash
python3 extract.py

python3 -m http.server 8080
```

## Releasing

Bump the `?v=` number on the `style.css`, `i18n.js` and `app.js` links in `index.html` whenever those files change: browsers keep scripts cached for hours, and the version makes them fetch the new ones.

## File format

Each node file has a 20-byte header, followed by vehicle nodes, ped nodes, navi nodes, and a links table. Coordinates are stored as signed 16-bit integers divided by 8 to get world units.
