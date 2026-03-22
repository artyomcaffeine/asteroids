from logger import log_state
from logger import log_event

from constants import SCREEN_WIDTH 
from constants import SCREEN_HEIGHT

import sys
import pygame

from asteroidfield import AsteroidField
from player import Player
from asteroid import Asteroid
from shot import Shot

def main():
    
    print(f"Starting Asteroids with pygame version: {pygame.version.ver}")
    print(f"Screen width: {SCREEN_WIDTH}")
    print(f"Screen height: {SCREEN_HEIGHT}")
    
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    
    Clock = pygame.time.Clock()
    dt = 0
    tick_rate = 60

    updatable = pygame.sprite.Group()
    drawable = pygame.sprite.Group()
    asteroids = pygame.sprite.Group()
    shots = pygame.sprite.Group()

    Player.containers = (updatable, drawable)
    player = Player(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2)
    
    AsteroidField.containers = (updatable)
    asteroidfield = AsteroidField()

    Asteroid.containers = (updatable, drawable, asteroids)

    Shot.containers = (updatable, drawable, shots)
    

    while True:
        log_state()
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
        
        dt = (Clock.tick(tick_rate))/1000
        screen.fill("black")
        updatable.update(dt)
        for ast in asteroids:
            if ast.collides_with(player):
                log_event("player_hit")
                print("Game Over!")
                sys.exit()
        for item in drawable:
            item.draw(screen)
        pygame.display.flip()

if __name__ == "__main__":
    main()
