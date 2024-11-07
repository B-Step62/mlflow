class AIGatewayConfigException(Exception):
    pass


class AIGatewayException(Exception):
    status_code: int
    detail: str
