package queue

import amqp "github.com/rabbitmq/amqp091-go"

func Connect(url string) error {
	conn, err := amqp.Dial(url)
	if err != nil {
		return err
	}
	ch, err = conn.Channel()
	return err
}
