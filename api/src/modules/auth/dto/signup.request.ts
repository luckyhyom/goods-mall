import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupRequest {
  @IsEmail()
  email: string;

  // bcrypt는 72바이트 초과분을 무시하므로 상한을 둔다
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;
}
