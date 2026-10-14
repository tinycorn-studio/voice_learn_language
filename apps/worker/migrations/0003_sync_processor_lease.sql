CREATE TABLE sync_processor_lease (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  lease_token TEXT NOT NULL, lease_until TEXT NOT NULL
);
INSERT INTO sync_processor_lease VALUES (1, '', '');
