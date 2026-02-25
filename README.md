# neufox's Node Viewer

Interactive map viewer for GTA San Andreas path nodes. Click any node to see its connections to adjacent nodes.

## What are path nodes?

GTA SA uses a system of 64 `NODES*.DAT` files (one per 750×750 unit sector) to define where vehicles and pedestrians can drive/walk. Each node is a point in 3D space; connections between nodes form the road/path network the game uses for navigation.

This viewer lets you explore that network visually, useful for understanding how NPC routing works, debugging custom NPC paths, or just curiosity.

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

## File format

Each node file has a 20-byte header, followed by vehicle nodes, ped nodes, navi nodes, and a links table. Coordinates are stored as signed 16-bit integers divided by 8 to get world units.
