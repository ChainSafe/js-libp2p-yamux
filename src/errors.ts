export class InvalidFrameError extends Error {
  static name = 'InvalidFrameError'

  constructor (message = 'The frame was invalid') {
    super(message)
    this.name = 'InvalidFrameError'
  }
}

export class UnrequestedPingError extends Error {
  static name = 'UnrequestedPingError'

  constructor (message = 'Unrequested ping error') {
    super(message)
    this.name = 'UnrequestedPingError'
  }
}

export class NotMatchingPingError extends Error {
  static name = 'NotMatchingPingError'

  constructor (message = 'Unrequested ping error') {
    super(message)
    this.name = 'NotMatchingPingError'
  }
}

export class InvalidStateError extends Error {
  static name = 'InvalidStateError'

  constructor (message = 'Invalid state') {
    super(message)
    this.name = 'InvalidStateError'
  }
}

export class StreamAlreadyExistsError extends Error {
  static name = 'StreamAlreadyExistsError'

  constructor (message = 'Strean already exists') {
    super(message)
    this.name = 'StreamAlreadyExistsError'
  }
}

export class DecodeInvalidVersionError extends Error {
  static name = 'DecodeInvalidVersionError'

  constructor (message = 'Decode invalid version') {
    super(message)
    this.name = 'DecodeInvalidVersionError'
  }
}

export class BothClientsError extends Error {
  static name = 'BothClientsError'

  constructor (message = 'Both clients') {
    super(message)
    this.name = 'BothClientsError'
  }
}

export class ReceiveWindowExceededError extends Error {
  static name = 'ReceiveWindowExceededError'

  constructor (message = 'Receive window exceeded') {
    super(message)
    this.name = 'ReceiveWindowExceededError'
  }
}
