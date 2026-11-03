package queue

import amqp "github.com/rabbitmq/amqp091-go"

var ch *amqp.Channel

func Publish(key, body string) {
	ch.Publish("tickets", key, false, false, amqp.Publishing{Body: []byte(body)})
}
