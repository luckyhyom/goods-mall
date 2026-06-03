import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * 인증 모듈. 토큰 발급/검증의 단일 책임자(TokenService)를 제공한다.
 * JwtModule 은 빈 설정으로 등록하고, 시크릿/TTL 은 TokenService 가
 * 발급 시점에 env 로부터 명시적으로 주입한다(검증 가드도 동일 시크릿 사용).
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [TokenService, AuthService],
  exports: [TokenService],
})
export class AuthModule {}
