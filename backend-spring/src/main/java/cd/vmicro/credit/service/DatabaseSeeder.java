package cd.vmicro.credit.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.sql.Date;

@Component
public class DatabaseSeeder implements CommandLineRunner {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final boolean seedDemoClients;

    public DatabaseSeeder(
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            @Value("${vmicro.seed.demo-clients:true}") boolean seedDemoClients
    ) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.seedDemoClients = seedDemoClients;
    }

    @Override
    public void run(String... args) {
        seedProviders();

        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class);
        if (count != null && count > 0) {
            return;
        }

        seedUser("usr_admin", "admin@vmicro.cd", "+243800000001", "Admin123!", "SUPER_ADMIN",
                "Super", "Admin V-Micro", "1988-01-10", "Kinshasa", "Gombe", "Direction Générale", 0);
        seedUser("usr_credit_agent", "credit.agent@vmicro.cd", "+243800000002", "Agent123!", "CREDIT_AGENT",
                "Chantal", "Mbuyi", "1990-04-12", "Kinshasa", "Lingwala", "Analyste Crédit", 0);
        seedUser("usr_kyc_agent", "kyc.agent@vmicro.cd", "+243800000003", "Agent123!", "VERIFICATION_AGENT",
                "Joseph", "Kabila-K", "1991-07-19", "Lubumbashi", "Kamalondo", "Agent Conformité KYC", 0);
        seedUser("usr_auditor", "auditor@vmicro.cd", "+243800000004", "Audit123!", "AUDITOR",
                "Nadine", "Tshiala", "1987-11-05", "Kinshasa", "Ngaliema", "Auditeur Interne", 0);

        if (!seedDemoClients) {
            return;
        }

        seedUser("usr_grace", "grace.kabongo@vmicro.cd", "+243812345678", "Password123!", "CLIENT",
                "Grâce", "Kabongo", "1994-06-14", "Kinshasa", "Bandalungwa", "Commerçante textile", 750);
        jdbc.update("UPDATE savings_accounts SET available_balance = 145.50, locked_goals_balance = 210.00 WHERE user_id = 'usr_grace'");
        jdbc.update(
                "INSERT INTO savings_goals (id, user_id, title, category, target_amount, current_amount, target_date, status) VALUES (?, 'usr_grace', ?, ?, ?, ?, ?, 'ACTIVE') ON CONFLICT (id) DO NOTHING",
                "goal_demo_1", "Stock boutique tissus", "Commerce", 350.00, 150.00, Date.valueOf("2027-06-01")
        );
        jdbc.update(
                "INSERT INTO savings_goals (id, user_id, title, category, target_amount, current_amount, target_date, status) VALUES (?, 'usr_grace', ?, ?, ?, ?, ?, 'ACTIVE') ON CONFLICT (id) DO NOTHING",
                "goal_demo_2", "Frais scolaires enfants", "Éducation", 120.00, 60.00, Date.valueOf("2027-09-01")
        );
        jdbc.update(
                "INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, is_simulated) VALUES ('kyc_demo_1', 'usr_grace', 'HALISI_FACE_LIVENESS', 'HalisiMockProvider', 'HAL-SIM-DEMO-01', TRUE, TRUE, TRUE, 'VERIFIED', TRUE) ON CONFLICT (id) DO NOTHING"
        );
    }

    private void seedUser(
            String id, String email, String phone, String rawPassword, String role,
            String firstName, String lastName, String dob, String city, String commune, String profession, double income
    ) {
        String hash = passwordEncoder.encode(rawPassword);
        jdbc.update(
                "INSERT INTO users (id, email, phone, password_hash, role, phone_verified, status) VALUES (?, ?, ?, ?, ?, TRUE, 'ACTIVE') ON CONFLICT (id) DO NOTHING",
                id, email, phone, hash, role
        );
        jdbc.update(
                "INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, city, commune, country, profession, monthly_income_usd, language) VALUES (?, ?, ?, ?, ?, ?, 'RDC', ?, ?, 'fr') ON CONFLICT (user_id) DO NOTHING",
                id, firstName, lastName, Date.valueOf(dob), city, commune, profession, income
        );
        jdbc.update(
                "INSERT INTO savings_accounts (id, user_id, currency, available_balance, locked_goals_balance, is_simulated) VALUES (?, ?, 'USD', 0, 0, TRUE) ON CONFLICT (user_id) DO NOTHING",
                "acc_" + id, id
        );
        jdbc.update(
                "INSERT INTO consents (id, user_id, consent_type, granted) VALUES (?, ?, 'TERMS_AND_DATA', TRUE) ON CONFLICT (id) DO NOTHING",
                "cns_" + id, id
        );
        jdbc.update(
                "INSERT INTO notification_preferences (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING",
                id
        );
    }

    private void seedProviders() {
        Object[][] providers = {
                {"AIRTEL_MONEY", "Airtel Money RDC", "MOBILE_MONEY", "SIMULATION", true},
                {"ORANGE_MONEY", "Orange Money RDC", "MOBILE_MONEY", "SIMULATION", true},
                {"VODACOM_MPESA", "Vodacom M-Pesa RDC", "MOBILE_MONEY", "SIMULATION", true},
                {"FLEXPAY_AGGREGATOR", "Agrégateur Mobile Money RDC", "AGGREGATOR", "SIMULATION", true},
                {"CARD_INTL", "Carte Bancaire Internationale", "CARD", "DISABLED_SANDBOX", false},
                {"HALISI_IDENTITY", "Halisi Identity & Credit", "IDENTITY_AND_SCORING", "MOCK_ADAPTER", true}
        };
        for (Object[] p : providers) {
            jdbc.update(
                    "INSERT INTO provider_configs (id, name, category, mode, enabled) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
                    p[0], p[1], p[2], p[3], p[4]
            );
        }
    }
}
