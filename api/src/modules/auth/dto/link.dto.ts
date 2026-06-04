import { IsString, MinLength } from 'class-validator';

/** OAuth 계정 연결: 콜백에서 받은 pending_link JWT + 기존 계정 패스워드 확인 */
export class LinkDto {
  @IsString()
  @MinLength(1)
  pending: string;

  @IsString()
  @MinLength(1)
  password: string;
}
