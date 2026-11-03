package tickets

import "database/sql"

var DB *sql.DB

func Save(title string) error {
	_, err := DB.Exec("insert into tickets (title) values ($1)", title)
	return err
}
