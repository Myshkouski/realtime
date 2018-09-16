const debug = require('debug')('parse-message-array')

function deserialize(ctx, next) {
  let {
    message
  } = ctx

  if(!ctx.rawMessage) {
    ctx.rawMessage = message
  }

  const typeOfMessage = typeof message

  if (typeOfMessage !== 'object') {
    if (Buffer.isBuffer(message)) {
      message = message.toString()
    } else if (typeOfMessage !== 'string') {
      throw new TypeError('Cannot parse message of type "' + typeOfMessage + '"')
    }

    message = JSON.parse(message)
  }

  if(Array.isArray(message)) {
    ctx.scope = message[0]
    ctx.payload = message[1]
  } else {
    ctx.scope = message.scope
    ctx.payload = message.payload
  }

  debug('scope: "%s", payload length: %d', ctx.scope, ctx.payload ? ('' + ctx.payload).length : 0)

  return next()
}

module.exports = options => {
  return function (ctx, next) {
    ctx.deserialize = deserialize
    return deserialize(ctx, next)
  }
}
