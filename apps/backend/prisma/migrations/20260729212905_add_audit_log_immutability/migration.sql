-- IATF 16949 / 21 CFR Part 11: AuditLog kayitlari olusturulduktan sonra
-- degistirilemez ve silinemez olmalidir. INSERT serbest kalir.
CREATE OR REPLACE FUNCTION audit_log_prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog kayitlari degistirilemez veya silinemez (immutable audit trail)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_update_delete();

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_update_delete();
