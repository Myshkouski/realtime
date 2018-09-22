const EventEmitter = require('events')
const RealtimeServer = require('@alexeimyshkouski/realtime-server')
const RealtimeRouter = require('@alexeimyshkouski/realtime-router')
const Hub = require('@alexeimyshkouski/pubsub')

const parseMessage = require('./parse-message-json')

const debug = require('debug')('realtime:application')

const eventPath = '(!|/event)/'
const enterPath = '(\\+|/enter)/'
const leavePath = '(\\-|/leave)/'
const modifyPath = '(.+)/'

const roomParamString = ':room'

function enter(room) {
  const ctx = this

  if (!ctx.rooms.has(room)) {
    const token = ctx.app.hub.subscribe(room, function subscriber(payload) {
      ctx.send(['!/' + room, payload])
    })

    if (token) {
      debug('entering room "%s"', room)

      ctx.rooms.set(token.channel, token)

      return true
    }
  }

  return false
}

function leave(room) {
  const ctx = this

  if (ctx.rooms.has(room)) {
    debug('leaving room "%s"', room)

    const token = ctx.rooms.get(room)

    token.unsubscribe()

    ctx.rooms.delete(room)

    return true
  }

  return false
}

const contextProto = {
  get rooms() {
    return this.app.rooms.get(this.socket)
  },
  enter,
  leave
}

const contextProtoOwnPropertyDescriptors = Object.getOwnPropertyDescriptors(contextProto)

function modifyContext(ctx, next) {
  Object.defineProperties(ctx, contextProtoOwnPropertyDescriptors)
  ctx.room = Hub.normalizeName(ctx.params.room)
  return next()
}

async function onEnter(ctx, next) {
  await next()

  const entered = ctx.enter(ctx.room)

  const message = [ctx.originalScope, entered]

  ctx.send(message)
}

async function onLeave(ctx, next) {
  await next()

  const left = ctx.leave(ctx.room)

  const message = [ctx.originalScope, left]

  ctx.send(message)
}

async function onEvent(ctx, next) {
  if (ctx.rooms.has(ctx.room)) {
    debug('message in "%s" from "%s"', ctx.params.room, ctx.socket.address().address)

    await next()

    this.emit(ctx.params.room, ctx)
  }
}

class Realtime extends EventEmitter {
  constructor() {
    super()

    const app = new RealtimeServer()
    this._app = app

    const router = new RealtimeRouter()
    this._router = router

    app
      .upgrade(async (ctx, next) => {
        await next()

        if (!ctx.app.rooms.has(ctx.socket)) {
          ctx.app.rooms.set(ctx.socket, new Map())

          ctx.socket.once('close', () => {
            const rooms = ctx.app.rooms.get(ctx.socket)

            for (const token of rooms.values()) {
              token.unsubscribe()
            }

            ctx.app.rooms.delete(ctx.socket)

            debug('socket closed', ctx.socket.address())
          })
        }
      })
      .message(router.middleware())

    router
      .message(parseMessage())
      .message(modifyPath + roomParamString, modifyContext)
      .message(enterPath + roomParamString, onEnter)
      .message(leavePath + roomParamString, onLeave)
      .message(eventPath + roomParamString, onEvent.bind(this))

    const hub = new Hub({
      separator: '/'
    })

    app.hub = hub
    app.rooms = new WeakMap()
  }

  get hub() {
    return this._app.hub
  }

  get connected() {
    return this._app.conencted
  }

  enter(room, fn) {
    this._router.message(enterPath + room, fn)

    return this
  }

  leave(room, fn) {
    this._router.message(leavePath + room, fn)

    return this
  }

  callback() {
    return this._app.callback()
  }
}

module.exports = Realtime
