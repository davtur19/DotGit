// popup/dsstore_parser.js
// Parses Apple's .DS_Store binary format (Buddy Allocator + B-tree).
// Returns a sorted array of unique filename strings found in the .DS_Store,
// or throws an Error with a descriptive message if the file is invalid.
//
// Format reference: Mark Mentovai's reverse-engineering notes (https://wiki.mozilla.org/DS_Store_File_Format).

function readU32(pos, buffer, view) {
    if (pos + 4 > buffer.byteLength) throw new TypeError('RU32: Unexpected end of file at 0x' + pos.toString(16));
    const v = view.getUint32(pos, false);
    return { value: v, pos: pos + 4 };
}

function readU16(pos, buffer, view) {
    if (pos + 2 > buffer.byteLength) throw new TypeError('RU16: Unexpected end of file at 0x' + pos.toString(16));
    const v = view.getUint16(pos, false);
    return { value: v, pos: pos + 2 };
}

function readU8(pos, buffer, bytes) {
    if (pos >= buffer.byteLength) throw new TypeError('RU8: Unexpected end of file at 0x' + pos.toString(16));
    return { value: bytes[pos], pos: pos + 1 };
}

function readAscii(pos, len, buffer, bytes) {
    if (pos + len > buffer.byteLength) throw new TypeError('ASCII: Unexpected end of file at 0x' + pos.toString(16));
    let s = '';
    for (let i = 0; i < len; i++) {
        s += String.fromCodePoint(bytes[pos + i]);
    }
    return { value: s, pos: pos + len };
}

function readUtf16beString(pos, charCount, buffer, view) {
    if (pos + charCount * 2 > buffer.byteLength) throw new TypeError('UTF16: Unexpected end of file at 0x' + pos.toString(16));
    let s = '';
    for (let i = 0; i < charCount; i++) {
        s += String.fromCodePoint(view.getUint16(pos + i * 2, false));
    }
    return { value: s, pos: pos + charCount * 2 };
}

function decodeBlockOffset(rawAddr) {
    return (rawAddr & ~0x1F) + 4;
}

function decodeBlockSize(rawAddr) {
    return 1 << (rawAddr & 0x1F);
}

function getBlockInfo(blockId, blockAddrs, blockCount, buffer) {
    if (blockId < 0 || blockId >= blockCount) {
        throw new TypeError('Block ID ' + blockId + ' out of range');
    }

    const rawAddr = blockAddrs[blockId];
    const offset = decodeBlockOffset(rawAddr);
    const size = decodeBlockSize(rawAddr);

    if (offset < 0 || offset + size > buffer.byteLength) {
        throw new TypeError('Decoded block ' + blockId + ' out of range (offset 0x' + offset.toString(16) + ', size ' + size + ')');
    }

    return { offset, size, rawAddr };
}

function valueDataSize(vt, atPos, buffer, view) {
    switch (vt) {
        case 'blob': {
            if (atPos + 4 > buffer.byteLength) throw new TypeError('blob length read out of range');
            const len = view.getUint32(atPos, false);
            return 4 + len;
        }
        case 'bool':
            return 1;
        case 'long':
            return 4;
        case 'shor':
            return 4;
        case 'ustr': {
            if (atPos + 4 > buffer.byteLength) throw new TypeError('ustr length read out of range');
            const charCount = view.getUint32(atPos, false);
            return 4 + charCount * 2;
        }
        case 'type':
            return 4;
        case 'comp':
            return 8;
        case 'dutc':
            return 8;
        default:
            throw new TypeError('Unknown DS_Store value type: "' + vt + '"');
    }
}

function readRecord(pos, buffer, view, bytes, filenames) {
    let result = readU32(pos, buffer, view);
    const fnLen = result.value;
    pos = result.pos;

    result = readUtf16beString(pos, fnLen, buffer, view);
    const filename = result.value;
    pos = result.pos;
    filenames.add(filename);

    if (pos + 4 > buffer.byteLength) throw new TypeError('Record structure type out of range');
    pos += 4;

    result = readAscii(pos, 4, buffer, bytes);
    const vt = result.value;
    pos = result.pos;

    const skip = valueDataSize(vt, pos, buffer, view);
    if (pos + skip > buffer.byteLength) throw new TypeError('Value data out of range for type "' + vt + '"');
    pos += skip;

    return pos;
}

function traverseNode(blockId, blockAddrs, blockCount, buffer, view, bytes, filenames, visited) {
    if (blockId < 0 || blockId >= blockCount) {
        throw new TypeError('B-tree node block ID ' + blockId + ' out of range');
    }

    if (visited.has(blockId)) return;
    visited.add(blockId);

    const block = getBlockInfo(blockId, blockAddrs, blockCount, buffer);
    let p = block.offset;
    const blockEnd = block.offset + block.size;

    if (p + 8 > blockEnd) {
        throw new TypeError('B-tree node header out of range for block ' + blockId);
    }

    const mode = view.getUint32(p, false);
    const count = view.getUint32(p + 4, false);
    p += 8;

    const isLeaf = (mode === 0);

    if (isLeaf) {
        for (let i = 0; i < count; i++) {
            const next = readRecord(p, buffer, view, bytes, filenames);
            if (next > blockEnd) throw new TypeError('Leaf record exceeds block boundary');
            p = next;
        }
        return;
    }

    const firstChild = mode;
    traverseNode(firstChild, blockAddrs, blockCount, buffer, view, bytes, filenames, visited);

    for (let i = 0; i < count; i++) {
        if (p + 4 > blockEnd) throw new TypeError('Internal node child pointer out of range');
        const childId = view.getUint32(p, false);
        p += 4;

        const next = readRecord(p, buffer, view, bytes, filenames);
        if (next > blockEnd) throw new TypeError('Internal node record exceeds block boundary');
        p = next;

        traverseNode(childId, blockAddrs, blockCount, buffer, view, bytes, filenames, visited);
    }
}

function parseDSStore(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError('DS_Store parser received an invalid datatype (expected ArrayBuffer)');
    }
    if (buffer.byteLength < 36) {
        throw new TypeError('.DS_Store file length exception.');
    }

    const view  = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    if (view.getUint32(0, false) !== 0x00000001) {
        throw new TypeError('Invalid .DS_Store magic (expected 0x00000001)');
    }

    const bud1 = String.fromCodePoint(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (bud1 !== 'Bud1') {
        throw new TypeError('Invalid .DS_Store magic (expected "Bud1", got "' + bud1 + '")');
    }

    const allocatorOffsetA = view.getUint32(0x08, false);
    const allocatorSize = view.getUint32(0x0C, false);
    const allocatorOffsetB = view.getUint32(0x10, false);

    if (allocatorOffsetA !== allocatorOffsetB) {
        throw new TypeError('Allocator offset copies do not match');
    }

    const rootOffset = allocatorOffsetA + 4;
    if (rootOffset >= buffer.byteLength) {
        throw new TypeError('Root block offset out of range: ' + rootOffset);
    }
    if (rootOffset + allocatorSize > buffer.byteLength) {
        throw new TypeError('Allocator bookkeeping block out of range');
    }

    let pos = rootOffset;

    let result = readU32(pos, buffer, view);
    const blockCount = result.value;
    pos = result.pos + 4;

    const blockAddrs = new Uint32Array(blockCount);
    for (let i = 0; i < blockCount; i++) {
        result = readU32(pos, buffer, view);
        blockAddrs[i] = result.value;
        pos = result.pos;
    }

    pos = rootOffset + 8 + (256 * 4);
    if (pos + 4 > buffer.byteLength) {
        throw new TypeError('Allocator directory header out of range');
    }

    result = readU32(pos, buffer, view);
    const dirCount = result.value;
    pos = result.pos;

    let dsdbBlockId = -1;
    for (let d = 0; d < dirCount; d++) {
        let r8 = readU8(pos, buffer, bytes);
        const nameLen = r8.value;
        pos = r8.pos;

        let nameResult = readAscii(pos, nameLen, buffer, bytes);
        const name = nameResult.value;
        pos = nameResult.pos;

        result = readU32(pos, buffer, view);
        const blockId = result.value;
        pos = result.pos;

        if (name === 'DSDB') {
            dsdbBlockId = blockId;
        }
    }

    if (dsdbBlockId === -1) {
        throw new TypeError('No directory entry header found in allocator block');
    }
    if (dsdbBlockId >= blockCount) {
        throw new TypeError('DSDB block ID ' + dsdbBlockId + ' out of range (block count: ' + blockCount + ')');
    }

    const masterBlock = getBlockInfo(dsdbBlockId, blockAddrs, blockCount, buffer);
    if (masterBlock.size < 20) {
        throw new TypeError('DSDB master block too small');
    }

    const rootNodeBlockId = view.getUint32(masterBlock.offset, false);
    if (rootNodeBlockId >= blockCount) {
        throw new TypeError('Root node block ID ' + rootNodeBlockId + ' out of range');
    }

    const filenames = new Set();
    const visited = new Set();

    traverseNode(rootNodeBlockId, blockAddrs, blockCount, buffer, view, bytes, filenames, visited);

    return Array.from(filenames)
        .filter(f => f !== '.')
        .sort((a, b) => a.localeCompare(b));
}
