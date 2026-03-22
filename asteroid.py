import pygame
import random
from logger import log_event
from constants import LINE_WIDTH
from constants import ASTEROID_MIN_RADIUS
from circleshape import CircleShape


class Asteroid(CircleShape):
    
    def __init__(self, x, y, radius):
        super().__init__(x, y, radius)
    
    def draw(self,screen):
        pygame.draw.circle(screen, "white", self.position, self.radius, LINE_WIDTH)

    def update(self,dt):
        self.position += self.velocity * dt

    def split(self):
        self.kill()
        if self.radius <= ASTEROID_MIN_RADIUS:
            return
        else:
            log_event("asteroid_split")
            random_angle = random.uniform(20, 50)
            new_asteroid_velocity = self.velocity.rotate(random_angle)
            new_asteroid_velocity_inverted = self.velocity.rotate(-random_angle)
            old_radius = self.radius
            new_asteroid_radius = old_radius - ASTEROID_MIN_RADIUS
            ast1 = Asteroid(self.position.x, self.position.y, new_asteroid_radius)
            ast2 = Asteroid(self.position.x, self.position.y, new_asteroid_radius)
            ast1.velocity = new_asteroid_velocity * 1.2
            ast2.velocity = new_asteroid_velocity_inverted * 1.2
