const EventEmitter = require('events')
const WsApp = require('@alexeimyshkouski/realtime-server')
const WsRouter = require('@alexeimyshkouski/realtime-router')
const Hub = require('@alexeimyshkouski/pubsub')

const parseMessage = require('./parse-message-json')

const debug = require('debug')('ws-framework')

async function onEnter(ctx, next) {
  await next()

  const room = Hub.normalizeName(ctx.params.room)

  const message = {
    scope: ctx.originalScope,
    payload: false
  }

  if (!ctx.rooms.has(room)) {
    const token = ctx.app.hub.subscribe(room, function subscriber(payload) {
      ctx.send({
        scope: '/event/' + room,
        payload
      })
    })

    if (token) {
      ctx.rooms.set(token.channel, token)

      message.payload = true
    }
  }

  ctx.send(message)
}

async function onLeave(ctx, next) {
  await next()

  const room = Hub.normalizeName(ctx.params.room)

  const message = {
    scope: ctx.originalScope,
    payload: false
  }

  if (ctx.rooms.has(room)) {
    const token = ctx.rooms.get(room)

    token.unsubscribe()

    ctx.rooms.delete(room)

    message.payload = true
  }

  ctx.send(message)
}

async function onEvent(ctx, next) {
  if (ctx.rooms.has(ctx.params.room)) {
    debug('message in "%s" from "%s"', ctx.params.room, ctx.socket.address().address)

    await next()

    this.emit(ctx.params.room, ctx)
  }
}

class Framework extends EventEmitter {
  constructor() {
    super()

    const app = new WsApp()
    this._app = app

    const router = new WsRouter()
    this._router = router

    app
      .upgrade(async (ctx, next) => {
        await next()

        if (!ctx.app.rooms.has(ctx.socket)) {
          ctx.app.rooms.set(ctx.socket, new Map())

          ctx.socket.once('close', () => {
            debug('socket closed', ctx.socket.address().address)
            const rooms = ctx.app.rooms.get(ctx.socket)

            for (const token of rooms.values()) {
              token.unsubscribe()
            }

            ctx.app.rooms.delete(ctx.socket)
          })
        }
      })
      .message(router.middleware())

    router
      .message(parseMessage())
      .message((ctx, next) => {
        Object.assign(ctx, {
          get rooms() {
            return ctx.app.rooms.get(ctx.socket)
          }
        })

        return next()
      })
      .message('(\\+|/enter)/:room', onEnter)
      .message('(\\-|/leave)/:room', onLeave)
      .message('(\\!|/event)/:room', onEvent.bind(this))

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

  callback() {
    return this._app.callback()
  }
}

module.exports = Framework
