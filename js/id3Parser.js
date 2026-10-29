// ==========================================================================
// MUSICFLOW — PURE JAVASCRIPT ID3 & AUDIO METADATA PARSER
// Supports ID3v1, ID3v2.2, ID3v2.3, ID3v2.4 and embedded APIC artwork
// ==========================================================================

const ID3Parser = (() => {
  /**
   * Parse metadata and embedded album artwork from an ArrayBuffer or Blob
   * @param {File|Blob|ArrayBuffer} fileOrBuffer
   * @returns {Promise<Object>}
   */
  async function parse(fileOrBuffer) {
    let buffer;
    let filename = '';
    if (fileOrBuffer instanceof Blob || (typeof File !== 'undefined' && fileOrBuffer instanceof File)) {
      filename = fileOrBuffer.name || '';
      buffer = await fileOrBuffer.slice(0, 1024 * 1024 * 4).arrayBuffer(); // Read first 4MB for tags
    } else if (fileOrBuffer instanceof ArrayBuffer) {
      buffer = fileOrBuffer;
    } else {
      throw new Error('Unsupported input for ID3Parser');
    }

    const view = new DataView(buffer);
    const result = {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      trackNumber: null,
      artwork: null, // Blob URL or data URL
      format: extractFormat(filename),
      filename: filename
    };

    // 1. Check for ID3v2 Header (starts with "ID3")
    if (buffer.byteLength >= 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      const majorVersion = view.getUint8(3); // 2, 3, or 4
      const flags = view.getUint8(5);
      const tagSize = parseSyncsafeInt(view.getUint32(6, false));

      let offset = 10;
      // Skip extended header if present
      if (flags & 0x40 && majorVersion >= 3) {
        const extHeaderSize = majorVersion === 3 ? view.getUint32(offset, false) : parseSyncsafeInt(view.getUint32(offset, false));
        offset += extHeaderSize + 4;
      }

      const limit = Math.min(buffer.byteLength, 10 + tagSize);

      while (offset + 10 <= limit) {
        let frameId = '';
        let frameSize = 0;

        if (majorVersion === 2) {
          if (offset + 6 > limit) break;
          frameId = getString(view, offset, 3);
          frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
          offset += 6;
        } else {
          frameId = getString(view, offset, 4);
          if (majorVersion === 4) {
            frameSize = parseSyncsafeInt(view.getUint32(offset + 4, false));
          } else {
            frameSize = view.getUint32(offset + 4, false);
          }
          offset += 10; // 4 ID + 4 Size + 2 Flags
        }

        if (!frameId || frameId.charCodeAt(0) === 0 || frameSize <= 0 || offset + frameSize > buffer.byteLength) {
          break;
        }

        const frameDataOffset = offset;
        offset += frameSize;

        try {
          parseFrame(frameId, view, frameDataOffset, frameSize, majorVersion, result);
        } catch (e) {
          // Continue scanning next frames
        }
      }
    }

    // 2. Check for ID3v1 at EOF if title or artist is still empty
    if ((!result.title || !result.artist) && buffer.byteLength >= 128) {
      const v1Offset = buffer.byteLength - 128;
      if (getString(view, v1Offset, 3) === 'TAG') {
        if (!result.title) result.title = cleanString(getString(view, v1Offset + 3, 30));
        if (!result.artist) result.artist = cleanString(getString(view, v1Offset + 33, 30));
        if (!result.album) result.album = cleanString(getString(view, v1Offset + 63, 30));
        if (!result.year) result.year = cleanString(getString(view, v1Offset + 93, 4));
      }
    }

    // 3. Smart Fallbacks from Filename if Metadata Missing
    if (!result.title) {
      result.title = fallbackTitleFromFilename(filename);
    }
    if (!result.artist) {
      result.artist = fallbackArtistFromFilename(filename) || 'Unknown Artist';
    }
    if (!result.album) {
      result.album = 'Local Audio';
    }

    return result;
  }

  function parseFrame(frameId, view, offset, size, version, result) {
    if (size <= 1) return;

    // Text Frames (TIT2/TT2 = Title, TPE1/TP1 = Artist, TALB/TAL = Album, TPE2 = Album Artist, TYER/TDRC = Year, TCON = Genre, TRCK = Track)
    if (frameId === 'TIT2' || frameId === 'TT2') {
      result.title = decodeText(view, offset, size);
    } else if (frameId === 'TPE1' || frameId === 'TP1') {
      result.artist = decodeText(view, offset, size);
    } else if (frameId === 'TALB' || frameId === 'TAL') {
      result.album = decodeText(view, offset, size);
    } else if (frameId === 'TPE2' || frameId === 'TP2') {
      result.albumArtist = decodeText(view, offset, size);
    } else if (frameId === 'TYER' || frameId === 'TDRC' || frameId === 'TYE') {
      result.year = decodeText(view, offset, size).substring(0, 4);
    } else if (frameId === 'TCON' || frameId === 'TCO') {
      result.genre = decodeText(view, offset, size);
    } else if (frameId === 'TRCK' || frameId === 'TRK') {
      const trk = decodeText(view, offset, size);
      const parsedTrk = parseInt(trk.split('/')[0], 10);
      if (!isNaN(parsedTrk)) result.trackNumber = parsedTrk;
    } else if (frameId === 'APIC' || frameId === 'PIC') {
      // Attached Picture (APIC)
      if (!result.artwork) {
        result.artwork = extractApic(view, offset, size, version);
      }
    }
  }

  function extractApic(view, offset, size, version) {
    try {
      const encoding = view.getUint8(offset);
      let pos = offset + 1;

      let mimeType = 'image/jpeg';
      if (version === 2) {
        const format = getString(view, pos, 3).toLowerCase();
        pos += 3;
        mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      } else {
        let mime = '';
        while (pos < offset + size && view.getUint8(pos) !== 0) {
          mime += String.fromCharCode(view.getUint8(pos));
          pos++;
        }
        pos++; // Skip null terminator
        if (mime) mimeType = mime;
      }

      // Skip Picture Type (1 byte)
      pos += 1;

      // Skip Description
      if (encoding === 0 || encoding === 3) {
        while (pos < offset + size && view.getUint8(pos) !== 0) pos++;
        pos++;
      } else {
        while (pos + 1 < offset + size && !(view.getUint8(pos) === 0 && view.getUint8(pos + 1) === 0)) pos += 2;
        pos += 2;
      }

      const imgBytes = new Uint8Array(view.buffer, pos, (offset + size) - pos);
      if (imgBytes.length > 0) {
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
          const blob = new Blob([imgBytes], { type: mimeType });
          return URL.createObjectURL(blob);
        } else {
          // Node or non-browser fallback
          const b64 = Buffer.from(imgBytes).toString('base64');
          return `data:${mimeType};base64,${b64}`;
        }
      }
    } catch (e) {
      // Failed to parse image
    }
    return null;
  }

  function decodeText(view, offset, size) {
    if (size <= 1) return '';
    const encoding = view.getUint8(offset);
    const dataOffset = offset + 1;
    const dataLength = size - 1;

    try {
      if (encoding === 0) { // ISO-8859-1
        return cleanString(getString(view, dataOffset, dataLength));
      } else if (encoding === 1 || encoding === 2) { // UTF-16
        const bytes = new Uint8Array(view.buffer, dataOffset, dataLength);
        const decoder = new TextDecoder('utf-16');
        return cleanString(decoder.decode(bytes));
      } else if (encoding === 3) { // UTF-8
        const bytes = new Uint8Array(view.buffer, dataOffset, dataLength);
        const decoder = new TextDecoder('utf-8');
        return cleanString(decoder.decode(bytes));
      }
    } catch (_) {
      return cleanString(getString(view, dataOffset, dataLength));
    }
    return '';
  }

  function parseSyncsafeInt(n) {
    return ((n & 0x7F000000) >> 3) | ((n & 0x007F0000) >> 2) | ((n & 0x00007F00) >> 1) | (n & 0x0000007F);
  }

  function getString(view, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      if (offset + i >= view.byteLength) break;
      const charCode = view.getUint8(offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str;
  }

  function cleanString(str) {
    return (str || '').replace(/\0/g, '').trim();
  }

  function extractFormat(filename) {
    if (!filename) return 'mp3';
    const ext = filename.split('.').pop().toLowerCase();
    const supported = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'];
    return supported.includes(ext) ? ext : 'mp3';
  }

  function fallbackTitleFromFilename(filename) {
    if (!filename) return 'Untitled Local Track';
    let base = filename.replace(/\.[^/.]+$/, ''); // Remove extension
    base = base.replace(/^[0-9]+[\s._-]+/, ''); // Remove leading track numbers "01 - "
    if (base.includes(' - ')) {
      const parts = base.split(' - ');
      const p0 = parts[0].trim();
      const p1 = parts[parts.length - 1].trim();
      // If p1 contains commas or multiple artist indicators (e.g. "Mithoon, Pritam, Sayeed Quadri"),
      // p1 is the artists and p0 is the title!
      if (p1.includes(',') || /\b(feat|ft|with|prod)\b/i.test(p1) || (!p0.includes('&') && p1.includes('&'))) {
        return p0 || 'Untitled Local Track';
      }
      return p1 || 'Untitled Local Track';
    }
    return base.trim() || 'Untitled Local Track';
  }

  function fallbackArtistFromFilename(filename) {
    if (!filename) return '';
    const base = filename.replace(/\.[^/.]+$/, '');
    if (base.includes(' - ')) {
      const parts = base.split(' - ');
      const p0 = parts[0].trim();
      const p1 = parts[parts.length - 1].trim();
      // If p1 contains commas or multiple artist indicators, p1 is the artist!
      if (p1.includes(',') || /\b(feat|ft|with|prod)\b/i.test(p1) || (!p0.includes('&') && p1.includes('&'))) {
        return p1;
      }
      return p0;
    }
    return '';
  }

  return {
    parse,
    extractFormat,
    fallbackTitleFromFilename,
    fallbackArtistFromFilename
  };
})();

if (typeof window !== 'undefined') {
  window.ID3Parser = ID3Parser;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ID3Parser;
}
