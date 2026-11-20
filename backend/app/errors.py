from dataclasses import dataclass


@dataclass
class ServiceError(Exception):
    """Erro conhecido que pode ser convertido em uma resposta pública da API."""
    status: int
    code: str
    message: str
    field: str | None = None

    def response(self):
        # O campo é opcional: só aparece quando o erro está ligado a uma entrada.
        error = {'code': self.code, 'message': self.message}
        if self.field:
            error['field'] = self.field
        return {'error': error}, self.status
