package cd.vmicro.credit.service;

import cd.vmicro.credit.entity.AuditLogEntity;
import cd.vmicro.credit.repository.AuditLogRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuditLogService {

    private final AuditLogRepository auditLogRepository;

    public AuditLogService(AuditLogRepository auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }

    @Transactional
    public AuditLogEntity recordAudit(
            String actorId,
            String actorRole,
            String action,
            String targetType,
            String targetId,
            Map<String, Object> metadata
    ) {
        AuditLogEntity entity = new AuditLogEntity();
        entity.setId("aud_" + UUID.randomUUID().toString().substring(0, 10));
        entity.setActorId(actorId);
        entity.setActorRole(actorRole != null ? actorRole : "SYSTEM");
        entity.setAction(action);
        entity.setTargetType(targetType);
        entity.setTargetId(targetId);
        entity.setMetadataJson(metadata != null ? metadata : Map.of());
        entity.setCreatedAt(OffsetDateTime.now());
        return auditLogRepository.save(entity);
    }

    @Transactional(readOnly = true)
    public List<AuditLogEntity> listLogs(int limit, String actionFilter, String targetTypeFilter, String actorIdFilter) {
        var page = PageRequest.of(0, Math.min(Math.max(1, limit), 250));
        if (actorIdFilter != null && !actorIdFilter.isBlank()) {
            return auditLogRepository.findByActorIdOrderByCreatedAtDesc(actorIdFilter.trim(), page);
        }
        if (targetTypeFilter != null && !targetTypeFilter.isBlank()) {
            return auditLogRepository.findByTargetTypeOrderByCreatedAtDesc(targetTypeFilter.trim(), page);
        }
        if (actionFilter != null && !actionFilter.isBlank()) {
            return auditLogRepository.findByActionContainingIgnoreCaseOrderByCreatedAtDesc(actionFilter.trim(), page);
        }
        return auditLogRepository.findAllByOrderByCreatedAtDesc(page);
    }

    @Transactional(readOnly = true)
    public Optional<AuditLogEntity> getById(String id) {
        return auditLogRepository.findById(id);
    }
}
