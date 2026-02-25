#!/usr/bin/env python3
"""
GTA SA Path Node Extractor
Read `NODES0.DAT`-`NODES63.DAT` and write compact JSON for the web viewer.

File format reference: GTAMods Wiki - Paths (GTA SA)
Header: 20 bytes (5 x uint32)
  - total_nodes (vehicle + ped)
  - vehicle_nodes
  - ped_nodes
  - navi_nodes
  - links_count

Section 1: Path nodes, 28 bytes each (vehicle first, then ped)
  offset  0: uint32  mem_addr (unused)
  offset  4: uint32  zero (unused)
  offset  8: int16   x  (divide by 8 for world coords)
  offset 10: int16   y  (divide by 8 for world coords)
  offset 12: int16   z  (divide by 8 for world coords)
  offset 14: int16   heuristic (always 0x7FFE)
  offset 16: uint16  link_id (first index into section 3)
  offset 18: uint16  area_id
  offset 20: uint16  node_id
  offset 22: uint8   path_width
  offset 23: uint8   flood_fill
  offset 24: uint32  flags (bits 0-3 = link count)

Section 2: Navi nodes, 14 bytes each (skipped)
Section 3: Links, 4 bytes each - (uint16 area_id, uint16 node_id)
Sections 4-7: skipped
"""

import struct
import json
import os

NODES_DIR = '/mnt/g/LongWayDrivers/scriptfiles/NPCs/nodes/'
OUTPUT_FILE = './data/nodes.json'

NODE_SIZE   = 28
NAVI_SIZE   = 14
LINK_SIZE   = 4


def parse_file(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()

    total_nodes, veh_count, ped_count, navi_count, links_count = \
        struct.unpack_from('<IIIII', data, 0)

    nodes      = []
    link_table = []

    offset = 20
    for i in range(total_nodes):
        x, y, z   = struct.unpack_from('<hhh', data, offset + 8)
        link_id,  = struct.unpack_from('<H',   data, offset + 16)
        flags,    = struct.unpack_from('<I',   data, offset + 24)
        link_count = flags & 0x0F
        is_ped     = i >= veh_count

        nodes.append({
            'x':          round(x / 8.0, 1),
            'y':          round(y / 8.0, 1),
            'z':          round(z / 8.0, 1),
            'is_ped':     is_ped,
            'link_id':    link_id,
            'link_count': link_count,
            'flags':      flags,
        })
        offset += NODE_SIZE

    offset += navi_count * NAVI_SIZE

    for i in range(links_count):
        target_area, target_node = struct.unpack_from('<HH', data, offset)
        link_table.append((target_area, int(target_node)))
        offset += LINK_SIZE

    return {
        'veh_count':   veh_count,
        'ped_count':   ped_count,
        'nodes':       nodes,
        'link_table':  link_table,
    }


def main():
    print('Reading node files...')

    area_data = {}
    for area in range(64):
        path = os.path.join(NODES_DIR, f'NODES{area}.DAT')
        if not os.path.exists(path):
            print(f'  WARNING: NODES{area}.DAT not found')
            continue
        d = parse_file(path)
        area_data[area] = d
        print(f'  Area {area:2d}: {d["veh_count"]:4d} veh + {d["ped_count"]:4d} ped  '
              f'({len(d["link_table"])} links)')

    print('\nAssigning global IDs...')

    global_id_map = {}
    veh_x = []
    veh_y = []
    veh_z = []
    veh_area  = []
    veh_flags = []
    ped_x = []
    ped_y = []
    ped_z = []
    ped_area = []

    for area in sorted(area_data):
        d = area_data[area]
        for i, node in enumerate(d['nodes']):
            if not node['is_ped']:
                gid = len(veh_x)
                global_id_map[(area, i)] = ('v', gid)
                veh_x.append(node['x'])
                veh_y.append(node['y'])
                veh_z.append(node['z'])
                veh_area.append(area)
                veh_flags.append(node['flags'])
            else:
                gid = len(ped_x)
                global_id_map[(area, i)] = ('p', gid)
                ped_x.append(node['x'])
                ped_y.append(node['y'])
                ped_z.append(node['z'])
                ped_area.append(area)

    total_veh = len(veh_x)
    total_ped = len(ped_x)
    print(f'  Vehicle nodes: {total_veh}')
    print(f'  Ped nodes:     {total_ped}')

    print('\nResolving links...')

    veh_adj = [[] for _ in range(total_veh)]
    ped_adj = [[] for _ in range(total_ped)]
    missing_links = 0

    for area in sorted(area_data):
        d = area_data[area]
        link_table = d['link_table']

        for i, node in enumerate(d['nodes']):
            src_type, src_gid = global_id_map[(area, i)]
            link_start = node['link_id']
            link_count = node['link_count']

            for j in range(link_count):
                idx = link_start + j
                if idx >= len(link_table):
                    missing_links += 1
                    continue

                t_area, t_local = link_table[idx]
                key = (t_area, t_local)
                if key not in global_id_map:
                    missing_links += 1
                    continue

                dst_type, dst_gid = global_id_map[key]

                if src_type == 'v' and dst_type == 'v':
                    if dst_gid not in veh_adj[src_gid]:
                        veh_adj[src_gid].append(dst_gid)
                elif src_type == 'p' and dst_type == 'p':
                    if dst_gid not in ped_adj[src_gid]:
                        ped_adj[src_gid].append(dst_gid)

    total_veh_edges = sum(len(a) for a in veh_adj)
    total_ped_edges = sum(len(a) for a in ped_adj)
    print(f'  Vehicle edges (directed): {total_veh_edges}')
    print(f'  Ped edges (directed):     {total_ped_edges}')
    if missing_links:
        print(f'  WARNING: {missing_links} unresolved link references')

    print('\nBuilding output...')

    out_veh = []
    for i in range(total_veh):
        out_veh.append([
            veh_x[i],
            veh_y[i],
            veh_z[i],
            veh_area[i],
            veh_flags[i],
            veh_adj[i],
        ])

    out_ped = []
    for i in range(total_ped):
        out_ped.append([
            ped_x[i],
            ped_y[i],
            ped_z[i],
            ped_area[i],
            ped_adj[i],
        ])

    output = {'v': out_veh, 'p': out_ped}

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f'\nWrote {OUTPUT_FILE}  ({size_kb:.0f} KB)')


if __name__ == '__main__':
    main()
