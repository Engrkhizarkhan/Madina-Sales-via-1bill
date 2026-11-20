-- release: additive
ALTER TABLE bookings ADD INDEX idx_bookings_created_page(created_at,id), ADD INDEX idx_bookings_travel_page(travel_date,created_at,id);
ALTER TABLE financial_transactions ADD INDEX idx_transactions_sale_booking(transaction_type,booking_id,id);
