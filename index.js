const EventEmitter = require('events')
const RealtimeServer = require('@alexeimyshkouski/realtime-server')
const RealtimeRouter = require('../realtime-router')
const Hub = require('@alexeimyshkouski/pubsub')

const parseMessage = require('./parse-message-json')

const debug = require('debug')('ws-framework')

const eventPath = '(!|/event)/'
const enterPath = '(\\+|/enter)/'
const leavePath = '(\\-|/leave)/'
const roomParam = ':room'

const contextProto = {
  get rooms() {
    return this.app.rooms.get(this.socket)
  },

  enter(room) {
    const ctx = this

    if (!ctx.rooms.has(room)) {
      const token = ctx.app.hub.subscribe(room, function subscriber(payload) {
        ctx.send({
          scope: '/event/' + room,
          payload
        })
      })

      if (token) {
        debug('entering room "%s"', room)

        ctx.rooms.set(token.channel, token)

        return true
      }
    }

    return false
  },

  leave(room) {
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
}

const contextProtoOwnPropertyDescriptors = Object.getOwnPropertyDescriptors(contextProto)

async function onEnter(ctx, next) {
  await next()

  const entered = ctx.enter(ctx.room)

  const message = {
    scope: ctx.originalScope,
    payload: entered
  }

  ctx.send(message)
}

async function onLeave(ctx, next) {
  await next()

  const left = ctx.leave(ctx.room)

  const message = {
    scope: ctx.originalScope,
    payload: left
  }

  ctx.send(message)
}

async function onEvent(ctx, next) {
  if (ctx.rooms.has(ctx.room)) {
    debug('message in "%s" from "%s"', ctx.params.room, ctx.socket.address().address)

    await next()

    this.emit(ctx.params.room, ctx)
  }
}

class Framework extends EventEmitter {
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
        Object.defineProperties(ctx, contextProtoOwnPropertyDescriptors)

        return next()
      })
      .message(':action/:room', (ctx, next) => {
        ctx.room = Hub.normalizeName(ctx.params.room)
        return next()
      })
      .message(enterPath + roomParam, onEnter)
      .message(leavePath + roomParam, onLeave)
      .message(eventPath + roomParam, onEvent.bind(this))

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

module.exports = Framework
