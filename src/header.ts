export class Header {
  public version: number // sizeof(uint8)
  public type: number // sizeof(uint8)
  public flags: number // sizeof(uint16)
  public streamID: number // sizeof(uint32)
  public length: number // sizeof(uint32)

  public static LENGTH = 12

  constructor(version: number, type: number, flags: number, streamID: number, length: number) {
    this.version = version
    this.type = type
    this.flags = flags
    this.streamID = streamID
    this.length = length
  }

  public static parse(buffer: Uint8Array): Header {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    const version = view.getUint8(0)
    const type = view.getUint8(1)
    const flags = view.getUint16(2, false)
    const streamID = view.getUint32(4, false)
    const length = view.getUint32(8, false)

    return new Header(version, type, flags, streamID, length)
  }

  public encode(): Uint8Array {
    const buffer = new ArrayBuffer(Header.LENGTH)
    const view = new DataView(buffer)

    view.setUint8(0, this.version)
    view.setUint8(1, this.type)
    view.setUint16(2, this.flags, false)
    view.setUint32(4, this.streamID, false)
    view.setUint32(8, this.length, false)

    return new Uint8Array(buffer)
  }
}
