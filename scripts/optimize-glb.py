#!/usr/bin/env python3
"""
GARAM: ZERO HOUR — glTF 2.0 (.glb) Asset Optimizer
Strips unused animations/orphan bufferViews and resizes/compresses embedded textures
while preserving 100% glTF 2.0 core compatibility (PNG for normal/alpha, JPEG for opaque).
"""
import json
import os
import struct
import subprocess
import sys
import tempfile


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _ = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError(f'Invalid GLB file: {path}')
    off = 12
    gltf = None
    bin_data = b''
    while off < len(data):
        clen, ctype = struct.unpack_from('<I4s', data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == b'JSON':
            gltf = json.loads(chunk.decode('utf-8'))
        elif ctype == b'BIN\x00':
            bin_data = chunk
    return gltf, bin_data


def write_glb(path, gltf, bin_data):
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '
    bin_pad = bytearray(bin_data)
    while len(bin_pad) % 4 != 0:
        bin_pad.append(0)

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_pad)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total_len))
        f.write(struct.pack('<I4s', len(json_bytes), b'JSON'))
        f.write(json_bytes)
        f.write(struct.pack('<I4s', len(bin_pad), b'BIN\x00'))
        f.write(bin_pad)


def get_image_roles(gltf):
    roles = {}
    texs = gltf.get('textures', [])
    for mat in gltf.get('materials', []):
        pbr = mat.get('pbrMetallicRoughness', {})
        for role, key in [('baseColor', 'baseColorTexture'), ('mr', 'metallicRoughnessTexture')]:
            if key in pbr and 'index' in pbr[key]:
                ti = pbr[key]['index']
                if ti < len(texs) and 'source' in texs[ti]:
                    roles.setdefault(texs[ti]['source'], set()).add(role)
        for role, key in [('normal', 'normalTexture'), ('occ', 'occlusionTexture'), ('emissive', 'emissiveTexture')]:
            if key in mat and 'index' in mat[key]:
                ti = mat[key]['index']
                if ti < len(texs) and 'source' in texs[ti]:
                    roles.setdefault(texs[ti]['source'], set()).add(role)
        if mat.get('alphaMode', 'OPAQUE') != 'OPAQUE':
            if 'baseColorTexture' in pbr and 'index' in pbr['baseColorTexture']:
                ti = pbr['baseColorTexture']['index']
                if ti < len(texs) and 'source' in texs[ti]:
                    roles.setdefault(texs[ti]['source'], set()).add('ALPHA')
    return roles


def compress_image(raw_bytes, mime, roles, max_albedo, max_data):
    is_normal = 'normal' in roles
    is_alpha = 'ALPHA' in roles
    max_dim = max_albedo if 'baseColor' in roles else max_data

    ext = '.png' if 'png' in mime else '.jpg'
    with tempfile.TemporaryDirectory() as td:
        in_path = os.path.join(td, 'in' + ext)
        with open(in_path, 'wb') as f:
            f.write(raw_bytes)

        # Keep PNG for normal maps & alpha-blended textures; JPEG for opaque albedo/MR/occ
        if is_normal or is_alpha:
            out_path = os.path.join(td, 'out.png')
            cmd = [
                'convert', in_path,
                '-resize', f'{max_dim}x{max_dim}>',
                '-strip',
                '-define', 'png:compression-level=9',
                out_path,
            ]
            new_mime = 'image/png'
        else:
            out_path = os.path.join(td, 'out.jpg')
            cmd = [
                'convert', in_path,
                '-resize', f'{max_dim}x{max_dim}>',
                '-strip',
                '-quality', '84',
                '-sampling-factor', '4:2:0',
                out_path,
            ]
            new_mime = 'image/jpeg'

        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(out_path, 'rb') as f:
            out_bytes = f.read()

        # If re-encoded file is somehow larger than original and mime didn't change, keep original
        if len(out_bytes) >= len(raw_bytes):
            return raw_bytes, mime
        return out_bytes, new_mime


def optimize_glb(in_path, out_path, max_albedo=1024, max_data=512, strip_anims=True):
    gltf, bin_data = read_glb(in_path)

    if strip_anims and 'animations' in gltf:
        del gltf['animations']

    # Collect referenced accessors
    used_accessors = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                used_accessors.add(prim['indices'])
            for ai in prim.get('attributes', {}).values():
                used_accessors.add(ai)
            for tgt in prim.get('targets', []):
                for ai in tgt.values():
                    used_accessors.add(ai)
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_accessors.add(skin['inverseBindMatrices'])
    for anim in gltf.get('animations', []):
        for s in anim.get('samplers', []):
            used_accessors.add(s['input'])
            used_accessors.add(s['output'])

    # Remap accessors
    old_accessors = gltf.get('accessors', [])
    acc_remap = {}
    new_accessors = []
    for old_idx in sorted(used_accessors):
        acc_remap[old_idx] = len(new_accessors)
        new_accessors.append(old_accessors[old_idx])

    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                prim['indices'] = acc_remap[prim['indices']]
            for k, v in list(prim.get('attributes', {}).items()):
                prim['attributes'][k] = acc_remap[v]
            for tgt in prim.get('targets', []):
                for k, v in list(tgt.items()):
                    tgt[k] = acc_remap[v]
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_remap[skin['inverseBindMatrices']]
    for anim in gltf.get('animations', []):
        for s in anim.get('samplers', []):
            s['input'] = acc_remap[s['input']]
            s['output'] = acc_remap[s['output']]

    gltf['accessors'] = new_accessors

    # Collect referenced bufferViews (from accessors + images)
    old_bvs = gltf.get('bufferViews', [])
    used_bvs = set()
    for acc in new_accessors:
        if 'bufferView' in acc:
            used_bvs.add(acc['bufferView'])
        sparse = acc.get('sparse')
        if sparse:
            used_bvs.add(sparse['indices']['bufferView'])
            used_bvs.add(sparse['values']['bufferView'])

    img_roles = get_image_roles(gltf)
    images = gltf.get('images', [])
    img_bv_map = {}
    for idx, im in enumerate(images):
        if 'bufferView' in im:
            img_bv_map[idx] = im['bufferView']

    # Rebuild compact binary buffer
    new_bin = bytearray()
    new_bvs = []
    bv_remap = {}

    def append_chunk(chunk_bytes, target=None, byte_stride=None):
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        offset = len(new_bin)
        new_bin.extend(chunk_bytes)
        bv = {
            'buffer': 0,
            'byteOffset': offset,
            'byteLength': len(chunk_bytes),
        }
        if target is not None:
            bv['target'] = target
        if byte_stride is not None:
            bv['byteStride'] = byte_stride
        idx = len(new_bvs)
        new_bvs.append(bv)
        return idx

    # Copy geometry/skin bufferViews
    for old_bv_idx in sorted(used_bvs):
        obv = old_bvs[old_bv_idx]
        start = obv.get('byteOffset', 0)
        length = obv['byteLength']
        chunk = bin_data[start:start + length]
        bv_remap[old_bv_idx] = append_chunk(chunk, obv.get('target'), obv.get('byteStride'))

    for acc in new_accessors:
        if 'bufferView' in acc:
            acc['bufferView'] = bv_remap[acc['bufferView']]
        sparse = acc.get('sparse')
        if sparse:
            sparse['indices']['bufferView'] = bv_remap[sparse['indices']['bufferView']]
            sparse['values']['bufferView'] = bv_remap[sparse['values']['bufferView']]

    # Compress & append image bufferViews
    for idx, im in enumerate(images):
        if idx not in img_bv_map:
            continue
        obv = old_bvs[img_bv_map[idx]]
        start = obv.get('byteOffset', 0)
        length = obv['byteLength']
        raw_img = bin_data[start:start + length]
        roles = img_roles.get(idx, set())
        comp_img, new_mime = compress_image(raw_img, im.get('mimeType', 'image/png'), roles, max_albedo, max_data)
        im['mimeType'] = new_mime
        im['bufferView'] = append_chunk(comp_img)

    gltf['bufferViews'] = new_bvs
    gltf['buffers'] = [{'byteLength': len(new_bin)}]

    write_glb(out_path, gltf, bytes(new_bin))
    in_mb = os.path.getsize(in_path) / 1048576
    out_mb = os.path.getsize(out_path) / 1048576
    print(f'OPTIMIZED {os.path.basename(out_path)}: {in_mb:.2f} MB -> {out_mb:.2f} MB ({100*(1-out_mb/in_mb):.0f}% smaller)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: optimize-glb.py <input.glb> <output.glb> [max_albedo=1024] [max_data=512]')
        sys.exit(1)
    max_a = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    max_d = int(sys.argv[4]) if len(sys.argv) > 4 else 512
    optimize_glb(sys.argv[1], sys.argv[2], max_a, max_d)
