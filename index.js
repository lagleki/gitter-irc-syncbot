var irc = require('irc')
var request = require('request')
var xtend = require('xtend')
var gitterClient = require('./gitter.js')

function escapeName (name) {
  var t = '**'
  while (name.indexOf(t) >= 0) t += '**'
  return t + ' ' + name + ' ' + t
}

module.exports = function (opts) {
  var gitter = gitterClient(opts.gitterApiKey)
  var headers = {
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + opts.gitterApiKey
  }

  var ircOpts = xtend({
    channels: [opts.ircChannel],
    autoConnect: false,
    retryCount: 20
  }, opts.ircOpts)

  var ircClient = new irc.Client(
    opts.ircServer || 'irc.freenode.net',
    opts.ircNick,
    ircOpts
  )

  function log (message) {
    console.error(message)
    if (opts.ircAdmin) ircClient.say(opts.ircAdmin, message)
  }

  ircClient.on('error', function (message) {
    console.error('IRC Error:', message)
  })

  console.log('Connecting to IRC..')
  ircClient.connect(function () {
    log('Connected to IRC, joined ' + opts.ircChannel)
    request.post({ url: 'https://api.gitter.im/v1/rooms', headers: headers, json: {uri: opts.gitterRoom} }, function (err, req, json) {
      if (err) return log(err)
      var gitterRoomId = json.id
      var postGitterMessageUrl = 'https://api.gitter.im/v1/rooms/' + gitterRoomId + '/chatMessages'

      request({url: 'https://api.gitter.im/v1/user', headers: headers, json: true}, function (err, res, json) {
        if (err) return log(err)
        var gitterName = json[0].username
        var gitterUserId = json[0].id
        log('Gitterbot ' + gitterName + ' on channel ' + opts.gitterRoom + '(' + gitterRoomId + ')')

        gitter.subscribe('/api/v1/rooms/' + gitterRoomId + '/chatMessages', gitterMessage, {})

        function gitterMessage (data) {
          if (data.operation !== 'create') return
          var message = data.model
          if (!message.fromUser) return
          var userName = message.fromUser.username
          if (userName === gitterName) return

          var lines = message.text.split('\n')
          if (lines.length > 4) {
            lines.splice(3)
            lines.push('[full message: https://gitter.im/' + opts.gitterRoom + '?at=' + message.id + ']')
          }

          var text = lines.map(function (line) {
            return '<' + userName + '>: ' + line
          }).join('\n')

          // ignore messages sent by GitterBot
          request.post({
            url: 'https://api.gitter.im/v1/user/' + gitterUserId + '/rooms/' + gitterRoomId + '/unreadItems',
            headers: headers,
            json: {chat: [ message.id ]}
          })
          console.log('gitter:', text)
          //send Gitter=>IRC:
          ircClient.say(opts.ircChannel, text)
          //send Gitter=>Telegram:
        }

        ircClient.on('message' + opts.ircChannel, function (from, message) {
            var text = '<' + from.replace(/_+$/g,'') + '>: ' + JSON.stringify(message).replace(/^\"/,'').replace(/\"$/,'').replace(/\\u00[0-9]+/g,'').replace(/\\\\/g,'\\').replace(/\\/g,'');
            text = text.split(" ");
            if (text.length>=1){
            	text[0] = text[0].replace(/[\[\]]/g,'').replace(/[`']/g,'h').replace(/-/g,'_');
            }
            text=text.join(" ")
            .replace(/^<.*?>: <[0-9,]*(.*?)>: /,'**$1**: ')
            .replace(/^<.*?>: &lt;[0-9,]*(.*?)&gt;: /,'<$1>: ')
            .replace(/^<(.*?)>: /,'**$1**: ')
            .replace(/^<(.*?)>:\n/,'');
          if (from === ircClient.nick) return
          console.log('irc:', text)
          //send IRC=>Gitter:
          request.post({url: postGitterMessageUrl, headers: headers, json: {text: text}})
          //send IRC=>Telegram:
        })
        ircClient.on('action', function (from, to, message) {
          if (to !== opts.ircChannel || from === ircClient.nick) return
          var text = '— ' + escapeName(from) + ' ' + message
          request.post({url: postGitterMessageUrl, headers: headers, json: {text: text}})
        })
        ircClient.on('pm', function (from, message) {
          if (from !== opts.ircAdmin) return ircClient.say('Your are not my master.')
          var commands = [
            'kill'
          ]
          if (message === commands[0]) {
            ircClient.say(from, 'Shutting down systems...')
            process.exit()
          } else {
            ircClient.say(from, 'Hi! I only understand: ' + commands.join(', '))
          }
        })
      })
    })
  })
}
