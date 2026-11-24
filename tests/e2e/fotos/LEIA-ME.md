# Fotos para os testes de ponta a ponta

Os cenários com rosto da seção 8.1 do projeto precisam de **fotos de voluntários
que consentiram** com o uso da imagem. Coloque nesta pasta:

| Arquivo           | Conteúdo                                           |
|-------------------|----------------------------------------------------|
| `pessoa-a-1.jpg`  | Pessoa A, foto usada no cadastro                   |
| `pessoa-a-2.jpg`  | Pessoa A, **outra** foto (simula a câmera da portaria) |
| `pessoa-b.jpg`    | Pessoa B, que não será cadastrada                  |

Cada foto deve ter **um único rosto**, de frente e bem iluminado.

> **Privacidade:** esta pasta está no `.gitignore`. Fotos de rosto são dados
> biométricos (LGPD, art. 11) e **nunca** devem ser versionadas. Apague as fotos
> depois da apresentação.

Execução: `pytest tests/e2e -v`. Sem as fotos, os cenários com rosto são pulados
e os demais testes continuam rodando.
