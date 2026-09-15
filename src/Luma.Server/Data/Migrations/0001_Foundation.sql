CREATE TABLE ApplicationState (
    Key TEXT PRIMARY KEY,
    Value TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO ApplicationState (Key, Value) VALUES ('instanceId', lower(hex(randomblob(16))));
