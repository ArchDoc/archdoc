create table accounts (id text primary key, name text not null);
create table postings (id text primary key, account_id text references accounts(id), cents bigint, settled boolean default false);
