package cd.vmicro.credit.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final JdbcTemplate jdbcTemplate;

    @Autowired
    public JwtAuthenticationFilter(JwtService jwtService, JdbcTemplate jdbcTemplate) {
        this.jwtService = jwtService;
        this.jdbcTemplate = jdbcTemplate;
    }

    public JwtAuthenticationFilter(JwtService jwtService) {
        this(jwtService, null);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            try {
                JwtService.JwtClaims claims = jwtService.parseAndVerify(token);
                if (isSessionActive(claims.sessionId())) {
                    var authority = new SimpleGrantedAuthority("ROLE_" + claims.role());
                    var authentication = new UsernamePasswordAuthenticationToken(
                            claims.userId(),
                            claims,
                            List.of(authority)
                    );
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                } else {
                    SecurityContextHolder.clearContext();
                }
            } catch (IllegalArgumentException ignored) {
                SecurityContextHolder.clearContext();
            }
        }
        filterChain.doFilter(request, response);
    }

    private boolean isSessionActive(String sessionId) {
        if (jdbcTemplate == null || sessionId == null || sessionId.isBlank()) {
            return true;
        }
        try {
            List<Boolean> rows = jdbcTemplate.queryForList(
                    "SELECT revoked FROM sessions WHERE id = ? LIMIT 1",
                    Boolean.class,
                    sessionId
            );
            return rows.isEmpty() || !Boolean.TRUE.equals(rows.get(0));
        } catch (DataAccessException ignored) {
            return true;
        }
    }
}
